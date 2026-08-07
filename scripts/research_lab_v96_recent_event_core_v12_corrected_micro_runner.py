import research_lab_v96_recent_event_core_v12_corrected as v12c


def micro_configs():
    return [
        v12c.SizeConfig('C15_FAST_025_100',15,0.0,0.25,5.0,1.00,-6.0,0.0,2,0.25),
        v12c.SizeConfig('C15_FAST_000_125',15,0.0,0.00,5.0,1.25,-6.0,0.0,2,0.00),
        v12c.SizeConfig('C15_SOFT_050_100',15,-2.0,0.50,5.0,1.00,-8.0,0.25,2,0.25),
        v12c.SizeConfig('C30_BAL_025_100',30,0.0,0.25,5.0,1.00,-8.0,0.25,2,0.25),
        v12c.SizeConfig('C30_AGG_000_125',30,2.0,0.00,5.0,1.25,-6.0,0.00,2,0.00),
        v12c.SizeConfig('C30_SOFT_050_100',30,-2.0,0.50,3.0,1.00,-8.0,0.25,3,0.25),
        v12c.SizeConfig('C45_BAL_025_125',45,0.0,0.25,8.0,1.25,-8.0,0.25,2,0.25),
        v12c.SizeConfig('C60_BAL_050_125',60,0.0,0.50,8.0,1.25,-10.0,0.25,3,0.25),
        v12c.SizeConfig('C15_NOSTREAK_025_125',15,0.0,0.25,5.0,1.25,-6.0,0.0,0,0.0),
        v12c.SizeConfig('C30_NOSTREAK_025_125',30,0.0,0.25,5.0,1.25,-8.0,0.25,0,0.0),
        v12c.SizeConfig('C15_DDONLY_075_125',15,-99.0,0.75,5.0,1.25,-6.0,0.0,0,0.0),
        v12c.SizeConfig('C30_DDONLY_075_100',30,-99.0,0.75,5.0,1.00,-8.0,0.25,0,0.0),
    ]

v12c.configs = micro_configs

if __name__ == '__main__':
    v12c.main()
