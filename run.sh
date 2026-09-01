#/usr/bin/bash
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js /home/klaus/Downloads/test200.pbn --max=50 --workers=1
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js /home/klaus/Downloads/test200.pbn --max=50 --workers=2
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js /home/klaus/Downloads/test200.pbn --max=50 --workers=4
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js /home/klaus/Downloads/test200.pbn --max=50 --workers=8
sleep 10
./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js /home/klaus/Downloads/test200.pbn --max=50 --workers=12
