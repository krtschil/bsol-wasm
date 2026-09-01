#!/usr/bin/env python3

import argparse
import re
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(
        description="Runs a command repeatedly and calculates the mean of 'Total time' values."
    )

    parser.add_argument(
        "-n",
        "--runs",
        type=int,
        default=10,
        help="Number of repeats (default: 10)",
    )

    parser.add_argument(
        "-d",
        "--delay",
        type=float,
        default=10,
        help="Delay between runs in seconds (default: 10)",
    )

    parser.add_argument(
        "command",
        nargs=argparse.REMAINDER,
        help="Command and arguments to execute",
    )

    args = parser.parse_args()

    # Remove optional "--" inserted before the command
    command = args.command
    if command and command[0] == "--":
        command = command[1:]

    # Validate arguments
    if args.runs < 1:
        print("Error: -n must be a positive integer.", file=sys.stderr)
        sys.exit(1)

    if args.delay < 0:
        print("Error: -d must be a non-negative number.", file=sys.stderr)
        sys.exit(1)

    if not command:
        print("Error: No command given.", file=sys.stderr)
        parser.print_usage(sys.stderr)
        sys.exit(1)

    values = []

    print(f"Run command {args.runs}x : {' '.join(command)}")
    print("---------------------------------------------")

    for i in range(1, args.runs + 1):

        # Run command and capture stdout + stderr
        try:
            result = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                check=False,
            )

            output = result.stdout

            if result.returncode != 0:
                print(
                    f"Warning: Run {i} failed with error code {result.returncode}.",
                    file=sys.stderr,
                )

        except OSError as e:
            print(
                f"Warning: Run {i} could not be executed: {e}",
                file=sys.stderr,
            )
            output = ""

        # Find the value on a line containing "Total time"
        value = None

        for line in output.splitlines():
            if "Total time" in line:
                # Expected format:
                # Total time         : 16363.0 ms ...
                match = re.search(
                    r"Total time\s*:\s*([0-9]+(?:\.[0-9]+)?)",
                    line,
                )

                if match:
                    value = float(match.group(1))
                    break

        if value is None:
            print(f"Run {i}: No value found!", file=sys.stderr)
            continue

        print(f"Run {i}: {value:g} ms")
        values.append(value)

        # Delay except after the last run
        if i < args.runs and args.delay > 0:
            time.sleep(args.delay)

    print("---------------------------------------------")

    count = len(values)

    if count == 0:
        print("Error: Couldn't capture valid values.", file=sys.stderr)
        sys.exit(1)

    # Calculate arithmetic mean
    average = sum(values) / count

    print(f"Number of valid runs : {count} / {args.runs}")
    print(f"Arithmetic mean      : {average:.3f} ms")


if __name__ == "__main__":
    main()
