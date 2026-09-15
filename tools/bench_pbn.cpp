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
  std::string extractDeal(const std::string &lineIn)
  {
    std::string line = lineIn;
    while (!line.empty() && (line.back() == '\r' || line.back() == '\n' ||
                              line.back() == ' ' || line.back() == '\t'))
      line.pop_back();

    if (line.empty() || line[0] == '%')
      return "";

    std::string candidate;
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

  // Extracts the value of a [Board "..."] PBN tag. Note the trailing
  // space in the prefix check, same reasoning as extractDeal()'s
  // "[Deal " check: a bare "[Board" prefix match could in principle
  // collide with some other differently-named tag that happens to
  // start with the same letters, so we require whitespace right after
  // the tag name, matching how PBN tags are always written.
  std::string extractBoardLabel(const std::string &lineIn)
  {
    std::string line = lineIn;
    while (!line.empty() && (line.back() == '\r' || line.back() == '\n' ||
                              line.back() == ' ' || line.back() == '\t'))
      line.pop_back();

    if (line.rfind("[Board ", 0) != 0)
      return "";

    auto first = line.find('"');
    auto last = line.rfind('"');
    if (first == std::string::npos || last == std::string::npos || last <= first)
      return "";

    return line.substr(first + 1, last - first - 1);
  }

  struct DealEntry
  {
    std::string deal;
    std::string label;
  };

  std::vector<DealEntry> loadDeals(const std::string &content, int maxBoards)
  {
    std::vector<DealEntry> deals;
    std::istringstream in(content);
    std::string line;
    std::string pendingLabel;
    int seq = 0;

    while (std::getline(in, line))
    {
      std::string boardLabel = extractBoardLabel(line);
      if (!boardLabel.empty())
      {
        // Remember it for whichever [Deal ...] line follows - PBN
        // records list [Board "N"] before [Deal "..."] for the same
        // board. A [Board ...] line is never itself a deal line, so
        // move on to the next line without trying extractDeal() on it.
        pendingLabel = boardLabel;
        continue;
      }

      std::string deal = extractDeal(line);
      if (!deal.empty())
      {
        seq++;
        // Fall back to a sequential number when the input has no
        // [Board ...] tags at all (e.g. bare "N:..." lines) or when a
        // deal line appears without one preceding it - so the tool
        // still works on minimal, tag-free input, just without a
        // "real" board label to show.
        std::string label = !pendingLabel.empty() ? pendingLabel : std::to_string(seq);
        deals.push_back({deal, label});
        pendingLabel.clear();

        if (maxBoards > 0 && static_cast<int>(deals.size()) >= maxBoards)
          break;
      }
    }
    return deals;
  }
}

extern "C" char *EMSCRIPTEN_KEEPALIVE benchmarkPBN(char *pbnContent, int maxBoards)
{
  std::vector<DealEntry> deals = loadDeals(pbnContent ? pbnContent : "", maxBoards);

  if (deals.empty())
  {
    const char *err = "{\"error\":\"no boards found in input\"}";
    char *out = (char *)malloc(strlen(err) + 1);
    strcpy(out, err);
    return out;
  }

  int solutions[20];
  for (int i = 0; i < 20; i++) solutions[i] = 1;

  int solved_ok = 0;
  int solved_err = 0;
  std::vector<double> perBoardMs;
  perBoardMs.reserve(deals.size());

  auto t0 = std::chrono::steady_clock::now();

  for (const auto &entry : deals)
  {
    DdTableDealPBN tableDealPBN;
    std::strncpy(tableDealPBN.cards, entry.deal.c_str(), sizeof(tableDealPBN.cards) - 1);
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

  std::vector<double> sorted = perBoardMs;
  std::sort(sorted.begin(), sorted.end());
  size_t n = sorted.size();
  double medianMs = (n % 2 == 1)
    ? sorted[n / 2]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0;

  std::string out;
  out.reserve(256 + perBoardMs.size() * 24);
  char scratch[192];

  snprintf(scratch, sizeof(scratch),
    "{\"boards\":%zu,\"solvedOk\":%d,\"solvedErr\":%d,\"totalMs\":%.1f,\"avgMs\":%.3f,\"medianMs\":%.3f,\"boardsPerSec\":%.1f,\"times\":[",
    deals.size(), solved_ok, solved_err, totalMs, avgMs, medianMs, boardsPerSec);
  out += scratch;

  for (size_t i = 0; i < perBoardMs.size(); i++)
  {
    snprintf(scratch, sizeof(scratch), i == 0 ? "%.3f" : ",%.3f", perBoardMs[i]);
    out += scratch;
  }

  // "labels" carries each board's real [Board "N"] number (or a
  // sequential fallback when the input has none), in the same order as
  // "times" - so index i of one corresponds to index i of the other.
  // Escaping is defensive: real PBN board labels are simple numbers in
  // practice, but the label text still comes from an external file.
  out += "],\"labels\":[";
  for (size_t i = 0; i < deals.size(); i++)
  {
    out += (i == 0 ? "\"" : ",\"");
    for (char c : deals[i].label)
    {
      if (c == '"' || c == '\\') out += '\\';
      out += c;
    }
    out += "\"";
  }
  out += "]}";

  char *result = (char *)malloc(out.size() + 1);
  memcpy(result, out.c_str(), out.size() + 1);
  return result;
}
