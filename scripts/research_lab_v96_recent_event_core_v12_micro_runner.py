import research_lab_v96_recent_event_core_v12 as v12


def micro_configs():
    return [
        v12.SizeConfig('M15_W0_25_S5_100_DD6_0',15,0.0,0.25,5.0,1.00,-6.0,0.0),
        v12.SizeConfig('M15_W0_0_S5_125_DD6_0',15,0.0,0.0,5.0,1.25,-6.0,0.0),
        v12.SizeConfig('M30_W0_25_S5_125_DD6_0',30,0.0,0.25,5.0,1.25,-6.0,0.0),
        v12.SizeConfig('M30_W2_0_S5_125_DD6_0',30,2.0,0.0,5.0,1.25,-6.0,0.0),
        v12.SizeConfig('M30_W0_50_S8_100_DD8_25',30,0.0,0.50,8.0,1.00,-8.0,0.25),
        v12.SizeConfig('M45_W0_25_S8_125_DD6_0',45,0.0,0.25,8.0,1.25,-6.0,0.0),
        v12.SizeConfig('M60_W0_25_S8_125_DD8_25',60,0.0,0.25,8.0,1.25,-8.0,0.25),
        v12.SizeConfig('M30_WM2_50_S3_100_DD6_25',30,-2.0,0.50,3.0,1.00,-6.0,0.25),
    ]

v12.configs=micro_configs
if __name__=='__main__':v12.main()
