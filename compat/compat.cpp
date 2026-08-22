/* Implements the small legacy surface that DDummy.cpp (unmodified) needs
   but which DDS3 (https://github.com/dds-bridge/dds) no longer provides
   verbatim: InitStart() and the John-Goacher CalcDDtableAndLeadsPBN()
   extension. Built entirely on top of DDS3's public legacy C API. */

#include "dll.h"

/* rho[seat] = the seat to that seat's right (standard bridge rotation
   N=0,E=1,S=2,W=3). Matches the constant used by the original DDS
   dds.cpp (there defined as a global, initialised once at startup). */
static const int rho4[4] = {3, 0, 1, 2};

void InitStart(int /*gb_ram*/, int ncores)
{
  /* DDS3 dropped per-call sizing (a SolverContext owns its own memory),
     but keeps these two legacy entry points for backward compatibility.
     SetMaxThreads() is documented as the direct successor of the old
     InitStart() thread-count argument. */
  SetMaxThreads(ncores);
  InitializeStaticMemory();
}

int CalcDDtableAndLeadsPBN(struct DdTableDealPBN tableDealPBN, int solutions[],
                            struct DdTableResults *tablep, struct SolvedBoards *solved)
{
  struct BoardsPBN bo;
  int ind = 0;

  bo.no_of_boards = 20;

  for (int tr = 4; tr >= 0; tr--)
  {
    for (int first = 0; first <= 3; first++)
    {
      bo.deals[ind].trump = tr;
      bo.deals[ind].first = first;
      bo.deals[ind].currentTrickSuit[0] = 0;
      bo.deals[ind].currentTrickSuit[1] = 0;
      bo.deals[ind].currentTrickSuit[2] = 0;
      bo.deals[ind].currentTrickRank[0] = 0;
      bo.deals[ind].currentTrickRank[1] = 0;
      bo.deals[ind].currentTrickRank[2] = 0;

      for (int c = 0; c < 80; c++)
        bo.deals[ind].remainCards[c] = tableDealPBN.cards[c];

      bo.target[ind] = -1;
      bo.solutions[ind] = solutions[ind];
      bo.mode[ind] = 1;
      ind++;
    }
  }

  int res = SolveAllBoards(&bo, solved);
  if (res != 1)
    return res;

  for (ind = 0; ind < 20; ind++)
  {
    tablep->res_table[bo.deals[ind].trump][rho4[bo.deals[ind].first]] =
        13 - solved->solved_board[ind].score[0];
  }

  return 1;
}
