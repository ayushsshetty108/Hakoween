# Expanded 24-station acquisition and run notes

## Acquired data

- Added 20 unique real USGS stream gages to the original four training stations: **24 training stations total**.
- Added **64,736** official daily mean discharge observations (parameter 00060, statistic 00003), 2010–2018. Nineteen added stations have 3,287 days; one has 2,283 actual days. Gaps were not filled.
- Expanded training file: **77,883 labeled station-days**.
- Open-Meteo ERA5 weather covers all 25 weather stations (24 training plus the original held-out test gauge), **91,300 daily station records** for 2010–2019. All requested precipitation, temperature, 0–7 cm soil-moisture, and 7–28 cm soil-moisture values are present; no missing weather measurements remain.
- Original competition `data/raw/train.csv`, `data/raw/test.csv`, production model, and `predictions.csv` remain untouched.

| USGS station | State | Station name | Drainage area (sq mi) | Daily discharge rows |
|---|---|---|---:|---:|
| 01010000 | Maine | St. John River at Ninemile Bridge, Maine | 1,338.00 | 3,287 |
| 01094400 | Massachusetts | NORTH NASHUA RIVER AT FITCHBURG, MA | 64.20 | 3,287 |
| 01200000 | New York | TENMILE RIVER NEAR GAYLORDSVILLE, CT | 203.00 | 3,287 |
| 01427207 | Pennsylvania | DELAWARE RIVER AT LORDVILLE NY | 1,590.00 | 3,287 |
| 01595300 | West Virginia | ABRAM CREEK AT OAKMONT, WV | 42.70 | 2,283 |
| 01595800 | West Virginia | NORTH BRANCH POTOMAC RIVER AT BARNUM, WV | 266.00 | 3,287 |
| 01613900 | Virginia | HOGUE CREEK NEAR HAYFIELD, VA | 15.90 | 3,287 |
| 02176930 | Georgia | CHATTOOGA RIVER AT BURRELLS FORD, NR PINE MTN, GA | 46.70 | 3,287 |
| 02228500 | Florida | NORTH PRONG ST. MARYS RIVER AT MONIAC, GA | 160.00 | 3,287 |
| 02339495 | Alabama | OSELIGEE CREEK NEAR LANETT AL | 86.40 | 3,287 |
| 02489500 | Louisiana | Pearl River near Bogalusa, LA | 6,573.00 | 3,287 |
| 04010500 | Minnesota | PIGEON RIVER AT MIDDLE FALLS NR GRAND PORTAGE MN | 609.00 | 3,287 |
| 04024430 | Wisconsin | NEMADJI RIVER NEAR SOUTH SUPERIOR, WI | 420.00 | 3,287 |
| 04031000 | Michigan | BLACK RIVER NEAR BESSEMER, MI | 200.00 | 3,287 |
| 05387440 | Iowa | Upper Iowa River at Bluffton, IA | 367.00 | 3,287 |
| 06614800 | Colorado | MICHIGAN RIVER NEAR CAMERON PASS, CO | 1.54 | 3,287 |
| 07047855 | Arkansas | Whiteman's Crk at Ind Dr at Jonesboro, AR | 6.63 | 3,287 |
| 09380000 | Arizona | COLORADO RIVER AT LEES FERRY, AZ | 111,800.00 | 3,287 |
| 10039500 | Idaho | BEAR RIVER AT BORDER, WY | 2,480.00 | 3,287 |
| 11501000 | Oregon | SPRAGUE RIVER NEAR CHILOQUIN, OR | 1,565.00 | 3,287 |

Drainage areas were taken from official USGS monitoring-location metadata. Mean basin elevation, slope, and forest cover are blank for the new stations where no verified basin-level source value was acquired; station elevation was not substituted.

## The VS Code path error

`solution.py` and `validate_submission.py` now resolve default relative paths from the project directory, based on the script file location. They no longer depend on VS Code's current working directory. A path-loading check from outside the project successfully loaded the 13,147-row competition train file and 365-row test file.

Open the inner `FLOODCAST_Hackathon_V2` folder in VS Code. Run:

```bash
python solution.py
```

For the expanded stations, run the isolated experiments explicitly:

```bash
python -m src.validation.isolated_experiments --input-dir data/expanded_24_station --output-dir reports/expanded_24_station
```

That command uses leave-one-station-out folds and preserves the official 40/30/20/10 metric weights. Expanded-set model evaluation has not been run as part of this download; the earlier four-station three-candidate results remain in `reports/isolated_experiments/`.
