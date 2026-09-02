/* bench_pbn.cpp - benchmark tool, exposed as a wasm function.
 *
 * Exports benchmarkPBN(pbnContent, maxBoards) -> JSON string, using the
 * exact same calling convention (EMSCRIPTEN_KEEPALIVE + malloc'd char*)
 * as DDummy.cpp's handleDDSRequest, and solving each board via
 * CalcDDtableAndLeadsPBN() - the same function handleDDSRequest('m', ...)
 * calls per request. maxBoards <= 0 means "all boards in the file".
 *
 * Accepted input formats (scanned for, line by line):
 *   1) A bare deal string, e.g.:
 *        N:AKQ.J92.T865.Q73 T94.AK87.9432.J6 8532.QT6.AK7.T92 J76.543.QJ.AK854
 *   2) A standard PBN "[Deal ...]" tag, e.g.:
 *        [Deal "N:AKQ.J92.T865.Q73 T94.AK87.9432.J6 8532.QT6.AK7.T92 J76.543.QJ.AK854"]
 * Any other line (blank lines, other PBN tags, comments starting with %)
 * is ignored. This is intentionally permissive rather than a full PBN
 * parser, since the production app only ever needs the raw deal string.
 *
 * Usage from Node (see out/bench_pbn_cli.js after building):
 *   node bench_pbn_cli.js boards.pbn
 *   node bench_pbn_cli.js boards.pbn 100      # only solve the first 100
 */

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <chrono>
#include <algorithm>
#include <sstream>
#include <string>
#include <vector>
#include "dll.h"
#include "emscripten.h"

extern "C" int CalcDDtableAndLeadsPBN(struct DdTableDealPBN tableDealPBN, int solutions[],
                                       struct DdTableResults *tablep, struct SolvedBoards *solved);

namespace
{
  // Extracts the deal string from either a bare line or a [Deal "..."] tag.
  // Returns an empty string if the line doesn't look like a deal at all.
  std::string extractDeal(const std::string &lineIn)
  {
    std::string line = lineIn;
    while (!line.empty() && (line.back() == '\r' || line.back() == '\n' ||
                              line.back() == ' ' || line.back() == '\t'))
      line.pop_back();

    if (line.empty() || line[0] == '%')
      return "";

    std::string candidate;
    // Note the trailing space: "[Deal " (with the space) but NOT
    // "[Dealer " - a naive prefix match on "[Deal" alone would
    // incorrectly also match the *different* [Dealer "N"] PBN tag
    // (who deals first), since "Dealer" starts with the same four
    // letters. That bug caused entire worker chunks to end up
    // containing nothing but [Dealer ...] tags when a .pbn file has
    // one per board record alternating 1:1 with real [Deal ...] tags -
    // silently starving that worker of all real work.
    if (line.rfind("[Deal ", 0) == 0)
    {
      auto first = line.find('"');
      auto last = line.rfind('"');
      if (first == std::string::npos || last == std::string::npos || last <= first)
        return "";
      candidate = line.substr(first + 1, last - first - 1);
    }
    else
    {
      candidate = line;
    }

    if (candidate.size() > 2 && candidate[1] == ':' &&
        (candidate[0] == 'N' || candidate[0] == 'E' ||
         candidate[0] == 'S' || candidate[0] == 'W') &&
        candidate.find('.') != std::string::npos)
      return candidate;

    return "";
  }

  std::vector<std::string> loadDeals(const std::string &content, int maxBoards)
  {
    std::vector<std::string> deals;
    std::istringstream in(content);
    std::string line;
    while (std::getline(in, line))
    {
      std::string deal = extractDeal(line);
      if (!deal.empty())
      {
        deals.push_back(deal);
        if (maxBoards > 0 && static_cast<int>(deals.size()) >= maxBoards)
          break;
      }
    }
    return deals;
  }
}

extern "C" char *EMSCRIPTEN_KEEPALIVE benchmarkPBN(char *pbnContent, int maxBoards)
{
  std::vector<std::string> deals = loadDeals(pbnContent ? pbnContent : "", maxBoards);

  if (deals.empty())
  {
    const char *err = "{\"error\":\"no boards found in input\"}";
    char *out = (char *)malloc(strlen(err) + 1);
    strcpy(out, err);
    return out;
  }

  int solutions[20];
  for (int i = 0; i < 20; i++) solutions[i] = 1; // table only, no lead-by-lead detail

  int solved_ok = 0;
  int solved_err = 0;
  std::vector<double> perBoardMs;
  perBoardMs.reserve(deals.size());

  auto t0 = std::chrono::steady_clock::now();

  for (const auto &dealStr : deals)
  {
    DdTableDealPBN tableDealPBN;
    // DdTableDealPBN.cards is a fixed 80-byte buffer (unchanged since the
    // original DDS 2.x era, see the README) - guard against overlong lines.
    std::strncpy(tableDealPBN.cards, dealStr.c_str(), sizeof(tableDealPBN.cards) - 1);
    tableDealPBN.cards[sizeof(tableDealPBN.cards) - 1] = '\0';

    DdTableResults table;
    SolvedBoards solved;

    auto boardT0 = std::chrono::steady_clock::now();
    int res = CalcDDtableAndLeadsPBN(tableDealPBN, solutions, &table, &solved);
    auto boardT1 = std::chrono::steady_clock::now();

    perBoardMs.push_back(std::chrono::duration<double, std::milli>(boardT1 - boardT0).count());
    if (res == 1) solved_ok++; else solved_err++;
  }

  auto t1 = std::chrono::steady_clock::now();
  double totalMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
  double avgMs = totalMs / static_cast<double>(deals.size());
  double boardsPerSec = 1000.0 / avgMs;

  // Median of the per-board solve times. Using the individually-timed
  // per-board durations (perBoardMs) rather than deriving it from
  // totalMs/avgMs, since the median needs the actual distribution, not
  // just the mean - a handful of unusually hard/easy boards can pull
  // the mean away from what a "typical" board actually costs.
  std::vector<double> sorted = perBoardMs;
  std::sort(sorted.begin(), sorted.end());
  size_t n = sorted.size();
  double medianMs = (n % 2 == 1)
    ? sorted[n / 2]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0;

  // "times" carries every individual per-board duration. This is what
  // lets a caller correctly pool results across several parallel
  // instances (e.g. bench_pbn_cli.js's multi-worker mode): avg/median
  // of *latency* (how long one board takes to solve) must be computed
  // from the individual solve durations, never from a parallel wall-clock
  // time divided by a board count - that conflates a throughput measure
  // with a latency measure and produces numbers that shrink simply
  // because more workers were used, independent of whether any of them
  // ran in true parallel. Only "boards/sec" is legitimately wall-clock
  // based, since that IS a throughput figure.
  std::string out;
  out.reserve(128 + perBoardMs.size() * 12);
  char scratch[160];

  snprintf(scratch, sizeof(scratch),
    "{\"boards\":%zu,\"solvedOk\":%d,\"solvedErr\":%d,\"totalMs\":%.1f,\"avgMs\":%.3f,\"medianMs\":%.3f,\"boardsPerSec\":%.1f,\"times\":[",
    deals.size(), solved_ok, solved_err, totalMs, avgMs, medianMs, boardsPerSec);
  out += scratch;

  for (size_t i = 0; i < perBoardMs.size(); i++)
  {
    snprintf(scratch, sizeof(scratch), i == 0 ? "%.3f" : ",%.3f", perBoardMs[i]);
    out += scratch;
  }
  out += "]}";

  char *result = (char *)malloc(out.size() + 1);
  memcpy(result, out.c_str(), out.size() + 1);
  return result;
}

