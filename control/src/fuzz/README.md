# Property tests

[fast-check](https://github.com/dubzzz/fast-check) properties for the parsers and
normalizers that take data from a modem, ModemManager or a router: the D-Bus body
codec, 3GPP location strings, cell info, observation normalization, the router
(HiLink, goform, HIMI) response parsers, mmcli SMS output, NMEA and the small
text parsers. They check that nothing throws on arbitrary input, that bounded
and finite values stay that way, and that accepted input round-trips.

`bun test` runs each property for 300 cases. For a longer, time-bounded run give
every property a number of seconds:

```sh
FUZZ_SECONDS=8 bun test --timeout 60000 src/fuzz
```

bun's own per-test timeout is 5 seconds, hence `--timeout`. Each property prints a `fuzz-runs <cases>` line. A failing property prints its seed and a shrunk
counterexample; replay it with `fc.assert(property, { seed, path })` and turn it
into a regression test next to the code it covers.
