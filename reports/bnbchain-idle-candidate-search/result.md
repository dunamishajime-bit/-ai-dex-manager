# BNB Chain Idle Candidate Search

CoinGecko platform dataでBNB Chainアドレスがあり、Binance USDT足がある未検証候補だけを対象にしました。

## Baseline

- end_equity: 82553.59
- CAGR: 108.22%
- MaxDD: -45.27%
- target_after_top_trade_removed: 95000
- searched: 145
- found: 1

## Passing Candidates

| candidate | blocked equity | blocked CAGR % | blocked MaxDD % | normal equity | address |
| --- | ---: | ---: | ---: | ---: | --- |
| PENGU | 95355.95 | 118.92 | -45.27 | 164873.23 | 0x6418c0dd099a9fda397c766304cdd918233e8847 |

## All Tested

| candidate | normal equity | blocked equity | normal delta | blocked delta | top trade pnl | pass? | address | error |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| PENGU | 164873.23 | 95355.95 | 82319.64 | 12802.36 | 104411.66 | yes | 0x6418c0dd099a9fda397c766304cdd918233e8847 |  |
| SIGN | 89184.87 | - | 6631.28 | - | 778.37 | no | 0x868fced65edbf0056c4163515dd840e9f287a4c3 | normal_end_equity_below_target |
| G | 98121.6 | 88767.03 | 15568.01 | 6213.44 | 12368.31 | no | 0x9c7beba8f6ef6643abd725e45a4e8387ef260649 |  |
| JOE | 87947.67 | - | 5394.08 | - | 19779.64 | no | 0x371c7ec6d8039ff7933a2aa28eb827ffe1f52f07 | normal_end_equity_below_target |
| ZRO | 129548.69 | 86047.47 | 46995.1 | 3493.88 | 20404.74 | no | 0x6985884c4392d348587b19cb9eaaf157f13271cd |  |
| ACE | 85411.22 | - | 2857.63 | - | 15577.26 | no | 0xc27a719105a987b4c34116223cae8bd8f4b5def4 | normal_end_equity_below_target |
| CGPT | 84660.24 | - | 2106.65 | - | 18702.64 | no | 0x9840652dc04fb9db2c43853633f0f62be6f00f98 | normal_end_equity_below_target |
| MOVE | 83421.38 | - | 867.79 | - | 832.45 | no | 0x95ca12cd249d27008a482009e101a8501cf3a64f | normal_end_equity_below_target |
| 0G | 82553.59 | - | 0 | - | 0 | no | 0x4b948d64de1f71fcd12fb586f4c776421a35b3ee | normal_end_equity_below_target |
| ALLO | 82553.59 | - | 0 | - | 0 | no | 0xcce5f304fd043d6a4e8ccb5376a4a4fb583b98d5 | normal_end_equity_below_target |
| ASTER | 82553.59 | - | 0 | - | 0 | no | 0x000ae314e2a2172a039b26378814c252734f556a | normal_end_equity_below_target |
| AT | 82553.59 | - | 0 | - | 0 | no | 0x9be61a38725b265bc3eb7bfdf17afdfc9d26c130 | normal_end_equity_below_target |
| BANK | 82553.59 | - | 0 | - | 0 | no | 0x3aee7602b612de36088f3ffed8c8f10e86ebf2bf | normal_end_equity_below_target |
| BARD | 82553.59 | - | 0 | - | 0 | no | 0xd23a186a78c0b3b805505e5f8ea4083295ef9f3a | normal_end_equity_below_target |
| BREV | 82553.59 | - | 0 | - | 0 | no | 0x086f405146ce90135750bbec9a063a8b20a8bffb | normal_end_equity_below_target |
| EDEN | 82553.59 | - | 0 | - | 0 | no | 0x235b6fe22b4642ada16d311855c49ce7de260841 | normal_end_equity_below_target |
| ENSO | 82553.59 | - | 0 | - | 0 | no | 0xfeb339236d25d3e415f280189bc7c2fbab6ae9ef | normal_end_equity_below_target |
| ERA | 82553.59 | - | 0 | - | 0 | no | 0x00312400303d02c323295f6e8b7309bc30fb6bce | normal_end_equity_below_target |
| EUL | 82553.59 | - | 0 | - | 0 | no | 0x2117e8b79e8e176a670c9fcf945d4348556bffad | normal_end_equity_below_target |
| F | 82553.59 | - | 0 | - | 0 | no | 0xd6a8dc25b26beb85cd0eef63e5d8d32048113b51 | normal_end_equity_below_target |
| FF | 82553.59 | - | 0 | - | 0 | no | 0xac23b90a79504865d52b49b327328411a23d4db2 | normal_end_equity_below_target |
| GIGGLE | 82553.59 | - | 0 | - | 0 | no | 0x20d6015660b3fe52e6690a889b5c51f69902ce0e | normal_end_equity_below_target |
| HEMI | 82553.59 | - | 0 | - | 0 | no | 0x5ffd0eadc186af9512542d0d5e5eafc65d5afc5b | normal_end_equity_below_target |
| HOLO | 82553.59 | - | 0 | - | 0 | no | 0x1a5d7e4c3a7f940b240b7357a4bfed30d17f9497 | normal_end_equity_below_target |
| KAT | 82553.59 | - | 0 | - | 0 | no | 0x3a9eed92422abdd7566fba8c34bb74b3f656dbb3 | normal_end_equity_below_target |
| KGST | 82553.59 | - | 0 | - | 0 | no | 0x94be0bba8e1e303fe998c9360b57b826f1a4f828 | normal_end_equity_below_target |
| KITE | 82553.59 | - | 0 | - | 0 | no | 0x904567252d8f48555b7447c67dca23f0372e16be | normal_end_equity_below_target |
| MIRA | 82553.59 | - | 0 | - | 0 | no | 0x7ce4bfc3a66d0fcf5d91dd846911c15c3ff82ecc | normal_end_equity_below_target |
| MITO | 82553.59 | - | 0 | - | 0 | no | 0x8e1e6bf7e13c400269987b65ab2b5724b016caef | normal_end_equity_below_target |
| NEWT | 82553.59 | - | 0 | - | 0 | no | 0xb8a677e6d805c8d743e6f14c8bc9c19305b5defc | normal_end_equity_below_target |
| NIGHT | 82553.59 | - | 0 | - | 0 | no | 0xfe930c2d63aed9b82fc4dbc801920dd2c1a3224f | normal_end_equity_below_target |
| NXPC | 82553.59 | - | 0 | - | 0 | no | 0xf2b51cc1850fed939658317a22d73d3482767591 | normal_end_equity_below_target |
| OPEN | 82553.59 | - | 0 | - | 0 | no | 0xa227cc36938f0c9e09ce0e64dfab226cad739447 | normal_end_equity_below_target |
| OPN | 82553.59 | - | 0 | - | 0 | no | 0x7977bf3e7e0c954d12cdca3e013adaf57e0b06e0 | normal_end_equity_below_target |
| PLUME | 82553.59 | - | 0 | - | 0 | no | 0x5afadcd1e8e3ca78ee2d37100102f2aec8bc0aa8 | normal_end_equity_below_target |
| PUMP | 82553.59 | - | 0 | - | 0 | no | 0x22b4fa9a13a0d303ad258ee6d62a6ac60364b0c9 | normal_end_equity_below_target |
| ROBO | 82553.59 | - | 0 | - | 0 | no | 0x475cbf5919608e0c6af00e7bf87fab83bf3ef6e2 | normal_end_equity_below_target |
| SOPH | 82553.59 | - | 0 | - | 0 | no | 0x73fbd93bfda83b111ddc092aa3a4ca77fd30d380 | normal_end_equity_below_target |
| TOWNS | 82553.59 | - | 0 | - | 0 | no | 0x00000000bca93b25a6694ca3d2109d545988b13b | normal_end_equity_below_target |
| TURTLE | 82553.59 | - | 0 | - | 0 | no | 0x66fd8de541c0594b4dccdfc13bf3a390e50d3afd | normal_end_equity_below_target |
| U | 82553.59 | - | 0 | - | 0 | no | 0x6f88dbed8f178f71f6a0c27df10d4f0b8ddf4444 | normal_end_equity_below_target |
| USD1 | 82553.59 | - | 0 | - | 0 | no | 0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d | normal_end_equity_below_target |
| USDE | 82553.59 | - | 0 | - | 0 | no | 0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34 | normal_end_equity_below_target |
| WLFI | 82553.59 | - | 0 | - | 0 | no | 0x47474747477b199288bf72a1d702f7fe0fb1deea | normal_end_equity_below_target |
| XPL | 82553.59 | - | 0 | - | 0 | no | 0xf84dd1ac34c0043d109f6600f98302cdd3e5a6eb | normal_end_equity_below_target |
| YB | 82553.59 | - | 0 | - | 0 | no | 0xfb93ee8152dd0a0e6f4b49c66c06d800cf1db72d | normal_end_equity_below_target |
| ZAMA | 82553.59 | - | 0 | - | 0 | no | 0x6907a5986c4950bdaf2f81828ec0737ce787519f | normal_end_equity_below_target |
| ZBT | 82553.59 | - | 0 | - | 0 | no | 0xfab99fcf605fd8f4593edb70a43ba56542777777 | normal_end_equity_below_target |
| ZKC | 82553.59 | - | 0 | - | 0 | no | 0x15247e6e23d3923a853ccf15940a20ccdf16e94a | normal_end_equity_below_target |
| ZKP | 82553.59 | - | 0 | - | 0 | no | 0xd89b7dd376e671c124352267516bef1c2cc231a3 | normal_end_equity_below_target |
| 币安人生 | 82553.59 | - | 0 | - | 0 | no | 0x924fa68a0fc644485b8df8abfa0a41c2e7744444 | normal_end_equity_below_target |
| XUSD | 81532.75 | - | -1020.84 | - | -483.03 | no | 0xf81ac2e1a0373dde1bce01e2fe694a9b7e3bfcb9 | normal_end_equity_below_target |
| HUMA | 81066.33 | - | -1487.26 | - | -4477.09 | no | 0x92516e0ddf1ddbf7fab1b79cac26689fdc5ba8e6 | normal_end_equity_below_target |
| SAHARA | 81032.96 | - | -1520.63 | - | -1520.81 | no | 0xfdffb411c4a70aa7c95d5c981a6fb4da867e1111 | normal_end_equity_below_target |
| ATA | 80085.73 | - | -2467.86 | - | 23322.66 | no | 0xa2120b9e674d3fc3875f415a7df52e382f141225 | normal_end_equity_below_target |
| WIN | 80018.19 | - | -2535.4 | - | 16902.27 | no | 0xaef0d72a118ce24fee3cd1d43d383897d05b4e99 | normal_end_equity_below_target |
| BABY | 79999.57 | - | -2554.02 | - | 7608.58 | no | 0x53e562b9b7e5e94b81f10e96ee70ad06df3d2657 | normal_end_equity_below_target |
| STG | 79435.24 | - | -3118.35 | - | 9029.22 | no | 0xb0d502e938ed5f4df2e681fe6e419ff29631d62b | normal_end_equity_below_target |
| TUT | 79425.64 | - | -3127.95 | - | 8962.46 | no | 0xcaae2a2f939f51d97cdfa9a86e79e3f085b799f3 | normal_end_equity_below_target |
| SCR | 78729.72 | - | -3823.87 | - | 19463.54 | no | 0xad96b68940b50fd539e23d198fff2c7e9b46be9c | normal_end_equity_below_target |
| WBETH | 78183.35 | - | -4370.24 | - | 22238.72 | no | 0xa2e3356610840701bdf5611a53974510ae27e2e1 | normal_end_equity_below_target |
| RESOLV | 77901.66 | - | -4651.93 | - | -14288.04 | no | 0xda6cef7f667d992a60eb823ab215493aa0c6b360 | normal_end_equity_below_target |
| FLOKI | 77887.64 | - | -4665.96 | - | 111718.05 | no | 0xfb5b838b6cfeedc2873ab27866079ac55363d37e | normal_end_equity_below_target |
| HFT | 77733.8 | - | -4819.79 | - | 14100.44 | no | 0x44ec807ce2f4a6f2737a92e985f318d035883e47 | normal_end_equity_below_target |
| TON | 77619.61 | - | -4933.99 | - | 8112.3 | no | 0x4255279af47cf10efb9a5c8839f90170f4ef759f | normal_end_equity_below_target |
| STO | 77319.82 | - | -5233.77 | - | 3673.91 | no | 0xdaf1695c41327b61b9b9965ac6a5843a3198cf07 | normal_end_equity_below_target |
| LA | 76741.12 | - | -5812.47 | - | -14981.25 | no | 0x389ad4bb96d0d6ee5b6ef0efaf4b7db0ba2e02a0 | normal_end_equity_below_target |
| HOME | 97007.71 | 76710.83 | 14454.12 | -5842.77 | 34049.72 | no | 0x4bfaa776991e85e5f8b1255461cbbd216cfc714f |  |
| AXL | 76709.94 | - | -5843.65 | - | 6117.89 | no | 0x8b1f4432f943c465a973fedc6d7aa50fc96f1f65 | normal_end_equity_below_target |
| USUAL | 76674.31 | - | -5879.28 | - | 10413.04 | no | 0x4acd4d03af6f9cc0fb7c5f0868b7b6287d7969c5 | normal_end_equity_below_target |
| SOLV | 76197.99 | - | -6355.6 | - | 16301.72 | no | 0xabe8e5cabe24cb36df9540088fd7ce1175b9bc52 | normal_end_equity_below_target |
| TKO | 75248.99 | - | -7304.6 | - | 14847.57 | no | 0x9f589e3eabe42ebc94a44727b3f3531c0c877809 | normal_end_equity_below_target |
| PROVE | 75121.88 | - | -7431.71 | - | -7432.56 | no | 0x7ddf164cecfddd0f992299d033b5a11279a15929 | normal_end_equity_below_target |
| FLOW | 74869.5 | - | -7684.09 | - | 7976.66 | no | 0x7dc31152f557f0a21897cab58b0d2d213a6d4444 | normal_end_equity_below_target |
| SHELL | 74256.91 | - | -8296.68 | - | 22238.06 | no | 0xf2c88757f8d03634671208935974b60a2a28bdb3 | normal_end_equity_below_target |
| TREE | 74117.68 | - | -8435.91 | - | -18304.09 | no | 0x77146784315ba81904d654466968e3a7c196d1f3 | normal_end_equity_below_target |
| COOKIE | 73413.53 | - | -9140.06 | - | 24681.49 | no | 0xc0041ef357b183448b235a8ea73ce4e4ec8c265f | normal_end_equity_below_target |
| PENDLE | 73115.2 | - | -9438.39 | - | 46286.49 | no | 0xb3ed0a426155b79b898849803e3b36552f7ed507 | normal_end_equity_below_target |
| IQ | 72775.34 | - | -9778.25 | - | 46971.23 | no | 0x0e37d70b51ffa2b98b4d34a5712c5291115464e3 | normal_end_equity_below_target |
| C | 71232.82 | - | -11320.77 | - | -21957.52 | no | 0x52c5f209795451cbdcf1d418c508af4525304444 | normal_end_equity_below_target |
| DIA | 71005.79 | - | -11547.8 | - | 37280 | no | 0x99956d38059cf7beda96ec91aa7bb2477e0901dd | normal_end_equity_below_target |
| USTC | 151523 | 70417.12 | 68969.41 | -12136.47 | 38286.48 | no | 0x23396cf899ca06c4472205fc903bdb4de249d6fc |  |
| BIO | 70337.84 | - | -12215.75 | - | 18757.91 | no | 0x226a2fa2556c48245e57cd1cba4c6c9e67077dd2 | normal_end_equity_below_target |
| W | 97322.53 | 70071.91 | 14768.94 | -12481.68 | 15110.05 | no | 0x380bf199b3173cf7b3b321848ae1c5014a124444 |  |
| LAYER | 68985.05 | - | -13568.54 | - | -3021.2 | no | 0xc2c23a86def9e9f5972a633b3d25f7ecbfa5e575 | normal_end_equity_below_target |
| NEIRO | 67386.46 | - | -15167.13 | - | 13652.23 | no | 0x94162acc63812d53ac2bcf1f4aef65863273e63b | normal_end_equity_below_target |
| COW | 65484.01 | - | -17069.58 | - | 10812.86 | no | 0x7aaaa5b10f97321345acd76945083141be1c5631 | normal_end_equity_below_target |
| 1INCH | 65210.29 | - | -17343.3 | - | 30416.9 | no | 0x111111111117dc0aa78b770fa6a738034120c302 | normal_end_equity_below_target |
| MAV | 65145.9 | - | -17407.69 | - | 7813.35 | no | 0xd691d9a68c887bdf34da8c36f63487333acfd103 | normal_end_equity_below_target |
| HAEDAL | 65025.98 | - | -17527.62 | - | 1804.62 | no | 0x3d9be0ac1001cd81c32464276d863d2ffdca4967 | normal_end_equity_below_target |
| D | 63541.62 | - | -19011.97 | - | 6400.39 | no | 0x8fb238058e71f828f505582e65b1d14f8cf52067 | normal_end_equity_below_target |
| YFI | 62819.36 | - | -19734.23 | - | 13876.98 | no | 0x0affe50d637114656f6ba27fa94abf0de260f918 | normal_end_equity_below_target |
| ACT | 62387.29 | - | -20166.3 | - | -658.9 | no | 0x9f3bcbe48e8b754f331dfc694a894e8e686ac31d | normal_end_equity_below_target |
| SHIB | 62355.76 | - | -20197.83 | - | 18812.84 | no | 0x2859e4544c4bb03966803b044a93563bd2d0dd4d | normal_end_equity_below_target |
| TURBO | 112799.73 | 62099.13 | 30246.14 | -20454.46 | 83111.18 | no | 0x9d0211c1b1a217a574cb55b0e9c367e56debeae0 |  |
| THE | 61808.52 | - | -20745.08 | - | 1107.2 | no | 0xf4c8e32eadec4bfe97e0f595add0f4450a863a11 | normal_end_equity_below_target |
| LAZIO | 60778.46 | - | -21775.13 | - | 5494.31 | no | 0x77d547256a2cd95f32f67ae0313e450ac200648d | normal_end_equity_below_target |
| BANANA | 56130.19 | - | -26423.4 | - | 4090.33 | no | 0x603c7f932ed1fc6575303d8fb018fdcbb0f39a95 | normal_end_equity_below_target |
| TRUMP | 56007.58 | - | -26546.01 | - | -19161.01 | no | 0x4ea98c1999575aaadfb38237dd015c5e773f75a2 | normal_end_equity_below_target |
| VANA | 55984.05 | - | -26569.54 | - | -6967.98 | no | 0x7ff7fa94b8b66ef313f7970d4eebd2cb3103a2c0 | normal_end_equity_below_target |
| ALT | 55720.07 | - | -26833.52 | - | 6130.82 | no | 0x5ca09af27b8a4f1d636380909087536bc7e2d94d | normal_end_equity_below_target |
| PARTI | 55611.33 | - | -26942.26 | - | -22132.7 | no | 0x59264f02d301281f3393e1385c0aefd446eb0f00 | normal_end_equity_below_target |
| FORM | 54891.88 | - | -27661.71 | - | 5918.42 | no | 0x5b73a93b4e5e4f1fd27d8b3f8c97d69908b5e284 | normal_end_equity_below_target |
| SUSHI | 51648.03 | - | -30905.56 | - | 18280.21 | no | 0x947950bcc74888a40ffa2593c5798f11fc9124c4 | normal_end_equity_below_target |
| TST | 51284.88 | - | -31268.71 | - | -86.32 | no | 0x86bb94ddd16efc8bc58e6b056e8df71d9e666429 | normal_end_equity_below_target |
| HIVE | 50086.58 | - | -32467.01 | - | 5313.84 | no | 0x8fb024a51841e45891579bdc924550996b72b0fd | normal_end_equity_below_target |
| LDO | 48380.92 | - | -34172.67 | - | 7797.31 | no | 0x986854779804799c1d68867f5e03e601e781e41b | normal_end_equity_below_target |
| BANANAS31 | 47664.61 | - | -34888.98 | - | -909.25 | no | 0x3d4f0513e8a29669b960f9dbca61861548a9a760 | normal_end_equity_below_target |
| HYPER | 45952.75 | - | -36600.84 | - | -13202.68 | no | 0xc9d23ed2adb0f551369946bd377f8644ce1ca5c4 | normal_end_equity_below_target |
| NFP | 45843.56 | - | -36710.03 | - | 8828.23 | no | 0x551897f8203bd131b350601d3ac0679ba0fc0136 | normal_end_equity_below_target |
| HEI | 45720.58 | - | -36833.01 | - | 9495.52 | no | 0xf8f173e20e15f3b6cb686fb64724d370689de083 | normal_end_equity_below_target |
| LUMIA | 45270.45 | - | -37283.14 | - | 9606.47 | no | 0x7f39bcdca8e0e581c1d43aaa1cb862aa1c8c2047 | normal_end_equity_below_target |
| AVA | 104206.54 | 45179.95 | 21652.95 | -37373.64 | 47348.97 | no | 0xd9483ea7214fcfd89b4fb8f513b544920e315a52 |  |
| BB | 44076.31 | - | -38477.28 | - | 11259.83 | no | 0x16f9cc3c6f8d8006cfc0ee693cef9d76b0d44c36 | normal_end_equity_below_target |
| MUBARAK | 43116.28 | - | -39437.31 | - | 5647.9 | no | 0x5c85d6c6825ab4032337f11ee92a72df936b46f6 | normal_end_equity_below_target |
| ADX | 43024.34 | - | -39529.25 | - | 10313.97 | no | 0x6bff4fb161347ad7de4a625ae5aa3a1ca7077819 | normal_end_equity_below_target |
| BONK | 42559.37 | - | -39994.22 | - | 17280.49 | no | 0xa697e272a73744b343528c3bc4702f2565b2f422 | normal_end_equity_below_target |
| MEME | 42462.91 | - | -40090.68 | - | 13660.06 | no | 0x193397bb76868c6873e733ad60d5953843ebc84e | normal_end_equity_below_target |
| ALPINE | 42365.14 | - | -40188.45 | - | 26551.83 | no | 0x287880ea252b52b63cc5f40a2d3e5a44aa665a76 | normal_end_equity_below_target |
| KERNEL | 41160.6 | - | -41393 | - | 15152.85 | no | 0x9ecaf80c1303cca8791afbc0ad405c8a35e8d9f1 | normal_end_equity_below_target |
| GPS | 40009.25 | - | -42544.34 | - | -3663.6 | no | 0x9a4a67721573f2c9209dfff972c52be4e3f6642e | normal_end_equity_below_target |
| WBTC | 39787.27 | - | -42766.32 | - | 5391.38 | no | 0x0555e30da8f98308edb960aa94c0db47230d2b9c | normal_end_equity_below_target |
| C98 | 39541.92 | - | -43011.67 | - | 11079.14 | no | 0xaec945e04baf28b135fa7c640f624f8d90f1c3a6 | normal_end_equity_below_target |
| ID | 38631.44 | - | -43922.15 | - | 12740.63 | no | 0x2dff88a56767223a5529ea5960da7a3f5f766406 | normal_end_equity_below_target |
| KNC | 38374.5 | - | -44179.1 | - | 8852.48 | no | 0xfe56d5892bdffc7bf58f2e84be1b2c32d21c308b | normal_end_equity_below_target |
| ARK | 37293.38 | - | -45260.21 | - | 9015.87 | no | 0xcae117ca6bc8a341d2e7207f30e180f0e5618b9d | normal_end_equity_below_target |
| BEL | 36836.29 | - | -45717.31 | - | 8538.72 | no | 0x8443f091997f06a61670b735ed92734f5628692f | normal_end_equity_below_target |
| FARM | 35558.77 | - | -46994.82 | - | 5095.46 | no | 0x4b5c23cac08a567ecf0c1ffca8372a45a5d33743 | normal_end_equity_below_target |
| JUP | 35515.53 | - | -47038.07 | - | 2700.02 | no | 0x0231f91e02debd20345ae8ab7d71a41f8e140ce7 | normal_end_equity_below_target |
| EDU | 34604.3 | - | -47949.3 | - | 11821.34 | no | 0xbdeae1ca48894a1759a8374d63925f21f2ee2639 | normal_end_equity_below_target |
| BMT | 34545.3 | - | -48008.3 | - | 3772.36 | no | 0x7d814b9ed370ec0a502edc3267393bf62d891b62 | normal_end_equity_below_target |
| AI | 34265.1 | - | -48288.49 | - | 7799.06 | no | 0x2598c30330d5771ae9f983979209486ae26de875 | normal_end_equity_below_target |
| LUNC | 33877.16 | - | -48676.43 | - | 7952.32 | no | 0x156ab3346823b651294766e23e6cf87254d68962 | normal_end_equity_below_target |
| LISTA | 33301.02 | - | -49252.57 | - | 9481.11 | no | 0xfceb31a79f71ac9cbdcf853519c1b12d379edc46 | normal_end_equity_below_target |
| CYBER | 32005.49 | - | -50548.1 | - | 8661.56 | no | 0x14778860e937f509e651192a90589de711fb88a9 | normal_end_equity_below_target |
| PEPE | 30849.61 | - | -51703.99 | - | 42620.17 | no | 0x25d887ce7a35172c62febfd67a1856f20faebb00 | normal_end_equity_below_target |
| GTC | 28876.92 | - | -53676.67 | - | 3832.01 | no | 0x6cd871fb811224aa23b6bf1646177cdfe5106416 | normal_end_equity_below_target |
| SANTOS | 25371.13 | - | -57182.46 | - | 6200.22 | no | 0xa64455a4553c9034236734faddaddbb64ace4cc7 | normal_end_equity_below_target |
| DEGO | 21993.9 | - | -60559.69 | - | 2992.39 | no | 0x3da932456d082cba208feb0b096d49b202bf89c8 | normal_end_equity_below_target |
| CFX | 18927.11 | - | -63626.48 | - | 1694.73 | no | 0xdf5ba79f0fd70c6609666d5ed603710609a530ab | normal_end_equity_below_target |
| MBOX | 18731.83 | - | -63821.77 | - | 4702.15 | no | 0x3203c9e46ca618c8c1ce5dc67e7e9d75f5da2377 | normal_end_equity_below_target |
| DEXE | 17390.41 | - | -65163.18 | - | 85438.24 | no | 0x6e88056e8376ae7709496ba64d37fa2f8015ce3e | normal_end_equity_below_target |
| SYN | 15638.6 | - | -66914.99 | - | 18828.32 | no | 0xa4080f1778e69467e905b8d6f72f6e441f9e9484 | normal_end_equity_below_target |
| ALICE | 12535.19 | - | -70018.4 | - | 7720.87 | no | 0xac51066d7bec65dc4589368da368b212745d63e8 | normal_end_equity_below_target |
| PHB | 11774.66 | - | -70778.93 | - | 10768.07 | no | 0x0409633a72d846fc5bbe2f98d88564d35987904d | normal_end_equity_below_target |