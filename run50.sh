#/usr/bin/bash
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=16
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=15
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=14
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=13
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=12
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=11
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=10
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=9
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=8
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=7
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=6
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=5
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=4
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=3
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=2
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js ~/Downloads/test50.pbn --workers=1

