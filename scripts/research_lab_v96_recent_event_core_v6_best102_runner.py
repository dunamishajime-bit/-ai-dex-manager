import research_lab_v96_recent_event_core_v6 as v6

BEST = v6.Config('SP4_L10_D5_B8_1_H84','SHORT_PULLBACK',10,5.0,8,1.0,0.0,84)
v6.configs = lambda: [BEST]

if __name__ == '__main__':
    v6.main()
