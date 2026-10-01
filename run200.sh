#/usr/bin/bash
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js hands/test200.pbn --workers=16
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js hands/test200.pbn --workers=12
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js hands/test200.pbn --workers=8
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js hands/test200.pbn --workers=4
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js hands/test200.pbn --workers=2
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js hands/test200.pbn --workers=1
