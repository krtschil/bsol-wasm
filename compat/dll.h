/* Compatibility shim: makes the original DDS 2.5.3-era dll.h consumers
   (here: DDummy.cpp, unmodified) compile and link against the modernised
   DDS3 dll.h from https://github.com/dds-bridge/dds (library/src/api/dll.h).

   Strategy: include the real, new header, then paper over the two kinds
   of renames DDS3 introduced:
     1) struct tag PascalCase renames   (dealPBN -> DealPBN, etc.)
     2) struct field snake_case renames (resTable -> res_table, etc.)
   via preprocessor macros, so DDummy.cpp itself needs zero edits.
*/

#include <api/dll.h>

/* --- 1) old lowerCamel struct tags -> new PascalCase struct tags --- */
#define dealPBN        DealPBN
#define futureTricks   FutureTricks
#define ddTableDealPBN DdTableDealPBN
#define ddTableResults DdTableResults
#define solvedBoards   SolvedBoards
#define parResults     ParResults
#define ddTableDeal    DdTableDeal
#define boardsPBN      BoardsPBN

/* --- 2) old field names -> new snake_case field names --- */
#define solvedBoard        solved_board
#define resTable           res_table
#define parScore           par_score
#define parContractsString par_contracts_string
#define noOfBoards         no_of_boards

/* --- 3) functions DDummy.cpp calls that no longer exist under the old
       name/signature in DDS3. Implemented in compat.cpp. --- */
#ifdef __cplusplus
extern "C" {
#endif

/* Old: void InitStart(int gb_ram, int ncores);
   DDS3 dropped per-call thread/memory sizing (SolverContext owns that),
   but keeps SetMaxThreads()/InitializeStaticMemory() as its nearest
   legacy equivalents. This shim just forwards to those. */
void InitStart(int gb_ram, int ncores);

/* Old: a John-Goacher-specific extension (July 2015), never part of
   upstream DDS, so DDS3 naturally does not have it either. Reimplemented
   here on top of DDS3's public SolveAllBoards(), reproducing the original
   20-board (5 strains x 4 leaders) sweep and the resulting table/leads. */
int CalcDDtableAndLeadsPBN(struct DdTableDealPBN tableDealPBN, int solutions[],
                            struct DdTableResults *tablep, struct SolvedBoards *solved);

#ifdef __cplusplus
}
#endif
