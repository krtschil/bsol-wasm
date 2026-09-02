This directory holds small, local patches applied on top of the
freshly-synced upstream sources by ../scripts/sync-upstream.sh.

Currently empty: the one patch this project needed
(001-dds_c_api-missing-dll-h-include.patch, working around a missing
#include in library_src/api/dds_c_api.cpp) turned out to already be
fixed upstream as of dds-bridge/dds commit 104cdd0 - so it was removed
rather than kept around unused. If a future sync finds new upstream
issues, add a patch here the same way: fix the freshly-synced file
directly under library_src/, then generate the patch with:

    cd <repo-root>
    git diff --no-index --relative \
      <(git show HEAD:library_src/some_file.cpp) library_src/some_file.cpp \
      > patches/00N-short-description.patch

(or more simply, if the fix is still uncommitted: `git diff -- library_src/some_file.cpp > patches/00N-short-description.patch`)
