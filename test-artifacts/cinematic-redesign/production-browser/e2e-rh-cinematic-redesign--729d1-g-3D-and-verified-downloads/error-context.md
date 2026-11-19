# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\rh-cinematic-redesign.spec.ts >> production generation, PDF, CAD editing, 3D and verified downloads
- Location: e2e\rh-cinematic-redesign.spec.ts:92:1

# Error details

```
TimeoutError: page.waitForResponse: Timeout 110000ms exceeded while waiting for event "response"
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - button "RH Planner" [ref=e6] [cursor=pointer]
      - button "Welcome" [ref=e13] [cursor=pointer]
      - button "ACTIVE PROJECT RH Browser Acceptance" [ref=e20] [cursor=pointer]:
        - generic [ref=e23]:
          - generic [ref=e24]: ACTIVE PROJECT
          - generic [ref=e25]: RH Browser Acceptance
    - navigation "Project workspace" [ref=e28]:
      - button "Setup" [ref=e29] [cursor=pointer]
      - button "CAD" [ref=e34] [cursor=pointer]
      - button "Edit plan" [ref=e42] [cursor=pointer]
      - button "Floor 3D" [ref=e46] [cursor=pointer]
      - button "Building 3D" [ref=e52] [cursor=pointer]
      - button "Structural CAD" [ref=e57] [cursor=pointer]
      - button "Engineering" [ref=e63] [cursor=pointer]
      - button "Exports" [ref=e68] [cursor=pointer]
    - generic [ref=e73]:
      - button "Save project" [ref=e74] [cursor=pointer]
      - button "Night" [ref=e79] [cursor=pointer]
      - button "Design assistant" [ref=e83] [cursor=pointer]:
        - generic [ref=e86]: Assistant
      - button "Open command palette" [ref=e87] [cursor=pointer]:
        - generic [ref=e90]: Commands
  - main [ref=e91]:
    - region "Architectural CAD workspace" [ref=e92]:
      - generic [ref=e93]:
        - heading "CAD studio" [level=1] [ref=e94]
        - 'button "Regenerate Variant (Seed #1)" [ref=e95] [cursor=pointer]'
        - button "Edit Plan" [ref=e96] [cursor=pointer]
        - generic "Deterministic solver engine · COMPACT_DOUBLE_LOADED" [ref=e97]: Deterministic Engine · COMPACT DOUBLE LOADED
        - generic "Internal assessment of the generated layout. Professional review required." [ref=e98]: Layout score 100 / 100
        - button "Export DWG" [ref=e99] [cursor=pointer]
        - button "Export DXF" [ref=e100] [cursor=pointer]
        - button "Export PDF" [ref=e101] [cursor=pointer]
        - status
      - generic [ref=e102]:
        - generic [ref=e103]:
          - generic [ref=e104]: "Footprint Geometry:"
          - generic [ref=e105]: Polygonal (42 vertices)
        - group "N-Shape & Category Alternatives" [ref=e106]:
          - generic [ref=e107]: "Shapes:"
          - button "Curved Crescent" [ref=e108] [cursor=pointer]
          - button "Y-Triskele" [ref=e109] [cursor=pointer]
          - button "Triangular" [ref=e110] [cursor=pointer]
          - button "Rotunda" [ref=e111] [cursor=pointer]
          - button "H-Shape" [ref=e112] [cursor=pointer]
          - button "Compact" [ref=e113] [cursor=pointer]
          - button "Switch Shape / Category (21)" [ref=e114] [cursor=pointer]
      - generic [ref=e115]:
        - generic "Model floors" [ref=e116]:
          - button "STILT_PARKING_PLAN" [ref=e117] [cursor=pointer]
          - button "1ST_FLOOR_PLAN" [ref=e118] [cursor=pointer]
          - button "2ND_FLOOR_PLAN" [ref=e119] [cursor=pointer]
          - button "3RD_FLOOR_PLAN" [ref=e120] [cursor=pointer]
          - button "4TH_FLOOR_PLAN" [ref=e121] [cursor=pointer]
          - button "TERRACE_PLAN" [ref=e122] [cursor=pointer]
        - toolbar "Engineering discipline overlay switcher" [ref=e123]:
          - generic [ref=e124]: "Discipline Plans:"
          - button "Architectural Plan" [pressed] [ref=e125] [cursor=pointer]
          - button "Structural + Chajja Plan" [ref=e126] [cursor=pointer]
          - button "Electrical Plan (M-ELEC)" [ref=e127] [cursor=pointer]
          - button "Plumbing & OTS Duct Plan (M-PLUMB)" [ref=e128] [cursor=pointer]
          - button "Fire Safety Plan (F-FIRE)" [ref=e129] [cursor=pointer]
          - button "False Ceiling Plan (A-CEIL)" [ref=e130] [cursor=pointer]
      - generic [ref=e131]:
        - img [ref=e135]:
          - generic:
            - generic "counter (2020 × 600 mm)" [ref=e207]
            - generic "stove (600 × 600 mm)" [ref=e211]
            - generic "sink (600 × 500 mm)" [ref=e221]
            - generic "oven (600 × 600 mm)" [ref=e226]
            - generic "fridge (700 × 700 mm)" [ref=e230]
            - generic "chair (450 × 450 mm)" [ref=e232]
            - generic "chair (450 × 450 mm)" [ref=e235]
            - generic "chair (450 × 450 mm)" [ref=e238]
            - generic "chair (450 × 450 mm)" [ref=e241]
            - generic "l_sofa (2400 × 2000 mm)" [ref=e244]
            - generic "coffee_table (1200 × 600 mm)" [ref=e249]
            - generic "tv_console (450 × 1800 mm)" [ref=e252]
            - generic "bed (1200 × 1900 mm)" [ref=e257]
            - generic "wardrobe (600 × 1800 mm)" [ref=e262]
            - generic "office_chair (550 × 550 mm)" [ref=e264]
            - generic "floor_lamp (300 × 300 mm)" [ref=e270]
            - generic "toilet (400 × 700 mm)" [ref=e274]
            - generic "sink (350 × 450 mm)" [ref=e278]
            - generic "shower (800 × 800 mm)" [ref=e283]
            - generic "toilet (400 × 700 mm)" [ref=e288]
            - generic "sink (450 × 350 mm)" [ref=e292]
            - generic "shower (900 × 900 mm)" [ref=e297]
            - generic "bed (2000 × 1500 mm)" [ref=e302]
            - generic "wardrobe (600 × 1800 mm)" [ref=e307]
            - generic "desk (1200 × 600 mm)" [ref=e309]
            - generic "office_chair (550 × 550 mm)" [ref=e312]
            - generic "counter (2020 × 600 mm)" [ref=e318]
            - generic "stove (600 × 600 mm)" [ref=e322]
            - generic "sink (600 × 500 mm)" [ref=e332]
            - generic "oven (600 × 600 mm)" [ref=e337]
            - generic "fridge (700 × 700 mm)" [ref=e341]
            - generic "chair (450 × 450 mm)" [ref=e343]
            - generic "chair (450 × 450 mm)" [ref=e346]
            - generic "chair (450 × 450 mm)" [ref=e349]
            - generic "chair (450 × 450 mm)" [ref=e352]
            - generic "l_sofa (2400 × 2000 mm)" [ref=e355]
            - generic "coffee_table (1000 × 500 mm)" [ref=e360]
            - generic "tv_console (1800 × 450 mm)" [ref=e363]
            - generic "bed (1200 × 1900 mm)" [ref=e368]
            - generic "wardrobe (600 × 1800 mm)" [ref=e373]
            - generic "office_chair (550 × 550 mm)" [ref=e375]
            - generic "floor_lamp (300 × 300 mm)" [ref=e381]
            - generic "toilet (400 × 700 mm)" [ref=e385]
            - generic "sink (350 × 450 mm)" [ref=e389]
            - generic "shower (800 × 800 mm)" [ref=e394]
            - generic "toilet (400 × 700 mm)" [ref=e399]
            - generic "sink (450 × 350 mm)" [ref=e403]
            - generic "shower (900 × 900 mm)" [ref=e408]
            - generic "bed (2000 × 1500 mm)" [ref=e413]
            - generic "wardrobe (600 × 1800 mm)" [ref=e418]
            - generic "desk (1200 × 600 mm)" [ref=e420]
            - generic "office_chair (550 × 550 mm)" [ref=e423]
            - generic "counter (1200 × 600 mm)" [ref=e429]
            - generic "stove (600 × 600 mm)" [ref=e433]
            - generic "sink (600 × 500 mm)" [ref=e443]
            - generic "oven (600 × 600 mm)" [ref=e448]
            - generic "chair (450 × 450 mm)" [ref=e452]
            - generic "chair (450 × 450 mm)" [ref=e455]
            - generic "sofa (2000 × 900 mm)" [ref=e458]
            - generic "coffee_table (1200 × 600 mm)" [ref=e463]
            - generic "tv_console (450 × 1800 mm)" [ref=e466]
            - generic "bed (2000 × 1800 mm)" [ref=e471]
            - generic "wardrobe (600 × 1800 mm)" [ref=e476]
            - generic "office_chair (550 × 550 mm)" [ref=e478]
            - generic "floor_lamp (300 × 300 mm)" [ref=e484]
            - generic "shower (800 × 800 mm)" [ref=e488]
            - generic "toilet (400 × 700 mm)" [ref=e493]
            - generic "sink (450 × 350 mm)" [ref=e497]
            - generic "shower (900 × 900 mm)" [ref=e502]
            - generic "shower (800 × 800 mm)" [ref=e507]
            - generic "bed (2000 × 1800 mm)" [ref=e512]
            - generic "wardrobe (600 × 1800 mm)" [ref=e517]
            - generic "desk (1200 × 600 mm)" [ref=e519]
            - generic "office_chair (550 × 550 mm)" [ref=e522]
            - generic "bed (1200 × 1900 mm)" [ref=e528]
            - generic "office_chair (550 × 550 mm)" [ref=e533]
            - generic "floor_lamp (300 × 300 mm)" [ref=e539]
            - generic "counter (1200 × 600 mm)" [ref=e543]
            - generic "stove (600 × 600 mm)" [ref=e547]
            - generic "sink (600 × 500 mm)" [ref=e557]
            - generic "oven (600 × 600 mm)" [ref=e562]
            - generic "fridge (700 × 700 mm)" [ref=e566]
            - generic "chair (450 × 450 mm)" [ref=e568]
            - generic "chair (450 × 450 mm)" [ref=e571]
            - generic "sofa (2000 × 900 mm)" [ref=e574]
            - generic "coffee_table (1000 × 500 mm)" [ref=e579]
            - generic "tv_console (450 × 1800 mm)" [ref=e582]
            - generic "bed (2000 × 1800 mm)" [ref=e587]
            - generic "wardrobe (600 × 1800 mm)" [ref=e592]
            - generic "office_chair (550 × 550 mm)" [ref=e594]
            - generic "floor_lamp (300 × 300 mm)" [ref=e600]
            - generic "shower (800 × 800 mm)" [ref=e604]
            - generic "toilet (400 × 700 mm)" [ref=e609]
            - generic "sink (450 × 350 mm)" [ref=e613]
            - generic "shower (900 × 900 mm)" [ref=e618]
            - generic "shower (800 × 800 mm)" [ref=e623]
            - generic "bed (2000 × 1800 mm)" [ref=e628]
            - generic "wardrobe (600 × 1800 mm)" [ref=e633]
            - generic "desk (1200 × 600 mm)" [ref=e635]
            - generic "office_chair (550 × 550 mm)" [ref=e638]
            - generic "bed (1200 × 1900 mm)" [ref=e644]
            - generic "desk (1200 × 600 mm)" [ref=e649]
            - generic "office_chair (550 × 550 mm)" [ref=e652]
            - generic "floor_lamp (300 × 300 mm)" [ref=e658]
          - generic [ref=e819]:
            - generic "Open passage - no door leaf"
            - generic "Sliding Door floor_typical_01::flat_01__door_balcony" [ref=e820] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_01__door_kitchen (click to toggle open/closed)" [ref=e821] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_01__door_utility (click to toggle open/closed)" [ref=e823] [cursor=pointer]
            - generic "Open passage - no door leaf"
            - generic "Single Door floor_typical_01::flat_01__door_master_bath (click to toggle open/closed)" [ref=e825] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_01__door_common_bath (click to toggle open/closed)" [ref=e827] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_01__door_bed_2 (click to toggle open/closed)" [ref=e829] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_01__door_master_bed (click to toggle open/closed)" [ref=e831] [cursor=pointer]
            - generic "Sliding Door floor_typical_01::flat_01__master_bed__balcony_door" [ref=e833] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_01__door_entrance (click to toggle open/closed)" [ref=e834] [cursor=pointer]
            - generic "Open passage - no door leaf"
            - generic "Sliding Door floor_typical_01::flat_02__door_balcony" [ref=e836] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_02__door_kitchen (click to toggle open/closed)" [ref=e837] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_02__door_utility (click to toggle open/closed)" [ref=e839] [cursor=pointer]
            - generic "Open passage - no door leaf"
            - generic "Single Door floor_typical_01::flat_02__door_master_bath (click to toggle open/closed)" [ref=e841] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_02__door_common_bath (click to toggle open/closed)" [ref=e843] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_02__door_bed_2 (click to toggle open/closed)" [ref=e845] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_02__door_master_bed (click to toggle open/closed)" [ref=e847] [cursor=pointer]
            - generic "Sliding Door floor_typical_01::flat_02__bed_2__balcony_door" [ref=e849] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_02__door_entrance (click to toggle open/closed)" [ref=e850] [cursor=pointer]
            - generic "Open passage - no door leaf"
            - generic "Sliding Door floor_typical_01::flat_03__door_balcony" [ref=e852] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_03__door_kitchen (click to toggle open/closed)" [ref=e853] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_03__door_utility (click to toggle open/closed)" [ref=e855] [cursor=pointer]
            - generic "Open passage - no door leaf"
            - generic "Single Door floor_typical_01::flat_03__door_master_bath (click to toggle open/closed)" [ref=e857] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_03__door_bath_2 (click to toggle open/closed)" [ref=e859] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_03__door_common_bath (click to toggle open/closed)" [ref=e861] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_03__door_master_bed (click to toggle open/closed)" [ref=e863] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_03__door_bed_2 (click to toggle open/closed)" [ref=e865] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_03__door_bed_3 (click to toggle open/closed)" [ref=e867] [cursor=pointer]
            - generic "Sliding Door floor_typical_01::flat_03__master_bed__balcony_door" [ref=e869] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_03__door_entrance (click to toggle open/closed)" [ref=e870] [cursor=pointer]
            - generic "Open passage - no door leaf"
            - generic "Sliding Door floor_typical_01::flat_04__door_balcony" [ref=e872] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_04__door_kitchen (click to toggle open/closed)" [ref=e873] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_04__door_utility (click to toggle open/closed)" [ref=e875] [cursor=pointer]
            - generic "Open passage - no door leaf"
            - generic "Single Door floor_typical_01::flat_04__door_master_bath (click to toggle open/closed)" [ref=e877] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_04__door_bath_2 (click to toggle open/closed)" [ref=e879] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_04__door_common_bath (click to toggle open/closed)" [ref=e881] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_04__door_master_bed (click to toggle open/closed)" [ref=e883] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_04__door_bed_2 (click to toggle open/closed)" [ref=e885] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_04__door_bed_3 (click to toggle open/closed)" [ref=e887] [cursor=pointer]
            - generic "Sliding Door floor_typical_01::flat_04__bed_2__balcony_door" [ref=e889] [cursor=pointer]
            - generic "Single Door floor_typical_01::flat_04__door_entrance (click to toggle open/closed)" [ref=e890] [cursor=pointer]
            - generic "Sliding Door floor_typical_01::door_core_lift_1" [ref=e892] [cursor=pointer]
            - generic "Sliding Door floor_typical_01::door_core_lift_2" [ref=e893] [cursor=pointer]
          - generic [ref=e985]:
            - generic [ref=e1005]: UP
            - generic [ref=e1006]: DN
            - generic [ref=e1026]: UP
            - generic [ref=e1027]: DN
          - generic [ref=e1028]:
            - generic [ref=e1032]: 98.4' (30.0m)
            - generic [ref=e1037]: 131.2' (40.0m)
            - generic [ref=e1038]: 7.9' × 4.7'
            - generic [ref=e1039]: 7.9' × 17.0'
            - generic [ref=e1040]: 8.6' × 6.0'
            - generic [ref=e1041]: 8.6' × 15.6'
            - generic [ref=e1042]: 16.5' × 13.0'
            - generic [ref=e1043]: 13.0' × 10.0'
            - generic [ref=e1044]: 8.5' × 4.9'
            - generic [ref=e1045]: 8.5' × 4.9'
            - generic [ref=e1046]: 4.5' × 9.8'
            - generic [ref=e1047]: 13.0' × 9.8'
            - generic [ref=e1048]: 13.0' × 4.9'
            - generic [ref=e1049]: 7.9' × 4.7'
            - generic [ref=e1050]: 7.9' × 17.0'
            - generic [ref=e1051]: 8.6' × 6.0'
            - generic [ref=e1052]: 8.6' × 15.6'
            - generic [ref=e1053]: 16.5' × 13.0'
            - generic [ref=e1054]: 13.0' × 9.8'
            - generic [ref=e1055]: 8.5' × 4.9'
            - generic [ref=e1056]: 8.5' × 4.9'
            - generic [ref=e1057]: 4.5' × 9.8'
            - generic [ref=e1058]: 13.0' × 10.0'
            - generic [ref=e1059]: 13.0' × 4.9'
            - generic [ref=e1060]: 5.2' × 4.7'
            - generic [ref=e1061]: 5.2' × 26.1'
            - generic [ref=e1062]: 5.2' × 6.0'
            - generic [ref=e1063]: 5.2' × 24.8'
            - generic [ref=e1064]: 10.5' × 18.4'
            - generic [ref=e1065]: 9.8' × 15.9'
            - generic [ref=e1066]: 6.2' × 3.9'
            - generic [ref=e1067]: 6.2' × 3.9'
            - generic [ref=e1068]: 6.2' × 3.9'
            - generic [ref=e1069]: 13.5' × 11.8'
            - generic [ref=e1070]: 19.7' × 16.5'
            - generic [ref=e1071]: 9.8' × 20.9'
            - generic [ref=e1072]: 9.8' × 4.9'
            - generic [ref=e1073]: 5.2' × 4.7'
            - generic [ref=e1074]: 5.2' × 26.1'
            - generic [ref=e1075]: 5.2' × 6.0'
            - generic [ref=e1076]: 5.2' × 24.8'
            - generic [ref=e1077]: 10.5' × 18.4'
            - generic [ref=e1078]: 19.7' × 16.5'
            - generic [ref=e1079]: 6.2' × 3.9'
            - generic [ref=e1080]: 6.2' × 3.9'
            - generic [ref=e1081]: 6.2' × 3.9'
            - generic [ref=e1082]: 13.5' × 11.8'
            - generic [ref=e1083]: 9.8' × 15.9'
            - generic [ref=e1084]: 9.8' × 20.9'
            - generic [ref=e1085]: 9.8' × 4.9'
            - generic [ref=e1086]: 7.2' × 7.2'
            - generic [ref=e1087]: 7.2' × 7.2'
            - generic [ref=e1088]: 9.8' × 14.8'
            - generic [ref=e1089]: 9.8' × 14.8'
            - generic [ref=e1090]: 7.9' × 107.0'
            - generic [ref=e1091]: 7.9' × 107.0'
            - generic [ref=e1092]: 25.6' × 7.9'
            - generic [ref=e1093]: 9.8' × 63.0'
            - generic [ref=e1094]: 29.5' × 45.5'
            - generic [ref=e1095]: 30.2' × 16.4'
          - generic [ref=e1096]:
            - generic [ref=e1097]: UTILITY
            - generic [ref=e1098]: 2420 x 1430 mm
            - generic [ref=e1099]: 3.5 sq m
            - generic [ref=e1100]: KITCHEN
            - generic [ref=e1101]: 2420 x 5170 mm
            - generic [ref=e1102]: 12.5 sq m
            - generic [ref=e1103]: BALCONY
            - generic [ref=e1104]: 2620 x 1830 mm
            - generic [ref=e1105]: 4.8 sq m
            - generic [ref=e1106]: DINING & FAMILY HALL
            - generic [ref=e1107]: 2620 x 4770 mm
            - generic [ref=e1108]: 12.5 sq m
            - generic [ref=e1109]: LIVING ROOM
            - generic [ref=e1110]: 5040 x 3960 mm
            - generic [ref=e1111]: 20.0 sq m
            - generic [ref=e1112]: MASTER BEDROOM
            - generic [ref=e1113]: 3960 x 3060 mm
            - generic [ref=e1114]: 12.1 sq m
            - generic [ref=e1115]: MASTER TOILET
            - generic [ref=e1116]: 2600 x 1500 mm
            - generic [ref=e1117]: 3.9 sq m
            - generic [ref=e1118]: COMMON BATHROOM
            - generic [ref=e1119]: 2600 x 1500 mm
            - generic [ref=e1120]: 3.9 sq m
            - generic [ref=e1121]: INTERNAL PASSAGE
            - generic [ref=e1122]: 1360 x 3000 mm
            - generic [ref=e1123]: 4.1 sq m
            - generic [ref=e1124]: BEDROOM 02
            - generic [ref=e1125]: 3960 x 3000 mm
            - generic [ref=e1126]: 11.9 sq m
            - generic [ref=e1127]: MASTER BEDROOM BALCONY
            - generic [ref=e1128]: 3960 x 1500 mm
            - generic [ref=e1129]: 5.9 sq m
            - generic [ref=e1130]: UTILITY
            - generic [ref=e1131]: 2420 x 1430 mm
            - generic [ref=e1132]: 3.5 sq m
            - generic [ref=e1133]: KITCHEN
            - generic [ref=e1134]: 2420 x 5170 mm
            - generic [ref=e1135]: 12.5 sq m
            - generic [ref=e1136]: BALCONY
            - generic [ref=e1137]: 2620 x 1830 mm
            - generic [ref=e1138]: 4.8 sq m
            - generic [ref=e1139]: DINING & FAMILY HALL
            - generic [ref=e1140]: 2620 x 4770 mm
            - generic [ref=e1141]: 12.5 sq m
            - generic [ref=e1142]: LIVING ROOM
            - generic [ref=e1143]: 5040 x 3960 mm
            - generic [ref=e1144]: 20.0 sq m
            - generic [ref=e1145]: MASTER BEDROOM
            - generic [ref=e1146]: 3960 x 3000 mm
            - generic [ref=e1147]: 11.9 sq m
            - generic [ref=e1148]: MASTER TOILET
            - generic [ref=e1149]: 2600 x 1500 mm
            - generic [ref=e1150]: 3.9 sq m
            - generic [ref=e1151]: COMMON BATHROOM
            - generic [ref=e1152]: 2600 x 1500 mm
            - generic [ref=e1153]: 3.9 sq m
            - generic [ref=e1154]: INTERNAL PASSAGE
            - generic [ref=e1155]: 1360 x 3000 mm
            - generic [ref=e1156]: 4.1 sq m
            - generic [ref=e1157]: BEDROOM 02
            - generic [ref=e1158]: 3960 x 3060 mm
            - generic [ref=e1159]: 12.1 sq m
            - generic [ref=e1160]: BEDROOM 02 BALCONY
            - generic [ref=e1161]: 3960 x 1500 mm
            - generic [ref=e1162]: 5.9 sq m
            - generic [ref=e1163]: UTILITY
            - generic [ref=e1164]: 1600 x 1430 mm
            - generic [ref=e1165]: 2.3 sq m
            - generic [ref=e1166]: KITCHEN
            - generic [ref=e1167]: 1600 x 7950 mm
            - generic [ref=e1168]: 12.7 sq m
            - generic [ref=e1169]: BALCONY
            - generic [ref=e1170]: 1600 x 1830 mm
            - generic [ref=e1171]: 2.9 sq m
            - generic [ref=e1172]: DINING & FAMILY HALL
            - generic [ref=e1173]: 1600 x 7550 mm
            - generic [ref=e1174]: 12.1 sq m
            - generic [ref=e1175]: LIVING ROOM
            - generic [ref=e1176]: 3200 x 5620 mm
            - generic [ref=e1177]: 18.0 sq m
            - generic [ref=e1178]: MASTER BEDROOM
            - generic [ref=e1179]: 3000 x 4860 mm
            - generic [ref=e1180]: 14.6 sq m
            - generic [ref=e1181]: MASTER TOILET
            - generic [ref=e1182]: 1900 x 1200 mm
            - generic [ref=e1183]: 2.3 sq m
            - generic [ref=e1184]: COMMON BATHROOM
            - generic [ref=e1185]: 1900 x 1200 mm
            - generic [ref=e1186]: 2.3 sq m
            - generic [ref=e1187]: TOILET 02
            - generic [ref=e1188]: 1900 x 1200 mm
            - generic [ref=e1189]: 2.3 sq m
            - generic [ref=e1190]: INTERNAL PASSAGE
            - generic [ref=e1191]: 4100 x 3600 mm
            - generic [ref=e1192]: 14.8 sq m
            - generic [ref=e1193]: BEDROOM 02
            - generic [ref=e1194]: 6000 x 5040 mm
            - generic [ref=e1195]: 30.2 sq m
            - generic [ref=e1196]: BEDROOM 03
            - generic [ref=e1197]: 3000 x 6360 mm
            - generic [ref=e1198]: 19.1 sq m
            - generic [ref=e1199]: MASTER BEDROOM BALCONY
            - generic [ref=e1200]: 3000 x 1500 mm
            - generic [ref=e1201]: 4.5 sq m
            - generic [ref=e1202]: UTILITY
            - generic [ref=e1203]: 1600 x 1430 mm
            - generic [ref=e1204]: 2.3 sq m
            - generic [ref=e1205]: KITCHEN
            - generic [ref=e1206]: 1600 x 7950 mm
            - generic [ref=e1207]: 12.7 sq m
            - generic [ref=e1208]: BALCONY
            - generic [ref=e1209]: 1600 x 1830 mm
            - generic [ref=e1210]: 2.9 sq m
            - generic [ref=e1211]: DINING & FAMILY HALL
            - generic [ref=e1212]: 1600 x 7550 mm
            - generic [ref=e1213]: 12.1 sq m
            - generic [ref=e1214]: LIVING ROOM
            - generic [ref=e1215]: 3200 x 5620 mm
            - generic [ref=e1216]: 18.0 sq m
            - generic [ref=e1217]: MASTER BEDROOM
            - generic [ref=e1218]: 6000 x 5040 mm
            - generic [ref=e1219]: 30.2 sq m
            - generic [ref=e1220]: MASTER TOILET
            - generic [ref=e1221]: 1900 x 1200 mm
            - generic [ref=e1222]: 2.3 sq m
            - generic [ref=e1223]: COMMON BATHROOM
            - generic [ref=e1224]: 1900 x 1200 mm
            - generic [ref=e1225]: 2.3 sq m
            - generic [ref=e1226]: TOILET 02
            - generic [ref=e1227]: 1900 x 1200 mm
            - generic [ref=e1228]: 2.3 sq m
            - generic [ref=e1229]: INTERNAL PASSAGE
            - generic [ref=e1230]: 4100 x 3600 mm
            - generic [ref=e1231]: 14.8 sq m
            - generic [ref=e1232]: BEDROOM 02
            - generic [ref=e1233]: 3000 x 4860 mm
            - generic [ref=e1234]: 14.6 sq m
            - generic [ref=e1235]: BEDROOM 03
            - generic [ref=e1236]: 3000 x 6360 mm
            - generic [ref=e1237]: 19.1 sq m
            - generic [ref=e1238]: BEDROOM 02 BALCONY
            - generic [ref=e1239]: 3000 x 1500 mm
            - generic [ref=e1240]: 4.5 sq m
            - generic [ref=e1241]: PASSENGER LIFT 01
            - generic [ref=e1242]: 2200 x 2200 mm
            - generic [ref=e1243]: 4.8 sq m
            - generic [ref=e1244]: PASSENGER LIFT 02
            - generic [ref=e1245]: 2200 x 2200 mm
            - generic [ref=e1246]: 4.8 sq m
            - generic [ref=e1247]: MAIN FIRE STAIRCASE
            - generic [ref=e1248]: 3000 x 4500 mm
            - generic [ref=e1249]: 13.5 sq m
            - generic [ref=e1250]: FIRE STAIRCASE 02
            - generic [ref=e1251]: 3000 x 4500 mm
            - generic [ref=e1252]: 13.5 sq m
            - generic [ref=e1253]: COMMON CIRCULATION 01
            - generic [ref=e1254]: 2400 x 32600 mm
            - generic [ref=e1255]: 78.2 sq m
            - generic [ref=e1256]: COMMON CIRCULATION 02
            - generic [ref=e1257]: 2400 x 32600 mm
            - generic [ref=e1258]: 78.2 sq m
            - generic [ref=e1259]: COMMON CIRCULATION 03
            - generic [ref=e1260]: 7800 x 2400 mm
            - generic [ref=e1261]: 18.7 sq m
            - generic [ref=e1262]: MEP / PLUMBING DUCT 01
            - generic [ref=e1263]: 800 x 4400 mm
            - generic [ref=e1264]: 3.5 sq m
            - generic [ref=e1265]: MEP / PLUMBING DUCT 02
            - generic [ref=e1266]: 3000 x 19200 mm
            - generic [ref=e1267]: 57.6 sq m
            - generic [ref=e1268]: OPEN-TO-SKY COURT / LIGHT AND AIR VOID
            - generic [ref=e1269]: 9000 x 13880 mm
            - generic [ref=e1270]: 124.9 sq m
            - generic [ref=e1271]: OPEN-TO-SKY COURT / LIGHT AND AIR VOID
            - generic [ref=e1272]: 9200 x 5000 mm
            - generic [ref=e1273]: 46.0 sq m
          - generic [ref=e1274]: "N"
        - complementary [ref=e1277]:
          - generic [ref=e1278]:
            - generic [ref=e1279]: Plot & Floor Info
            - generic [ref=e1281]:
              - region "Generation controls" [ref=e1282]:
                - generic [ref=e1283]:
                  - generic [ref=e1284]:
                    - generic [ref=e1285]: Controlled refinement
                    - strong [ref=e1286]: Locks + regenerate selected
                  - generic [ref=e1287]: Footprint protected
                - generic [ref=e1291]:
                  - button "Lock Floor" [ref=e1292] [cursor=pointer]
                  - button "Lock Core" [ref=e1296] [cursor=pointer]
                - generic "Room refinement selection" [ref=e1300]:
                  - button "Kitchen Utility Balcony" [ref=e1301] [cursor=pointer]
                  - button "Kitchen" [ref=e1303] [cursor=pointer]
                  - button "Balcony" [ref=e1305] [cursor=pointer]
                  - button "Dining & Family Hall" [ref=e1307] [cursor=pointer]
                  - button "Living Room" [ref=e1309] [cursor=pointer]
                  - button "Master Bedroom" [ref=e1311] [cursor=pointer]
                  - button "Master Toilet" [ref=e1313] [cursor=pointer]
                  - button "Common Bathroom" [ref=e1315] [cursor=pointer]
                  - button "Internal Passage" [ref=e1317] [cursor=pointer]
                  - button "Bedroom 02" [ref=e1319] [cursor=pointer]
                  - button "Master Bedroom Balcony" [ref=e1321] [cursor=pointer]
                  - button "Kitchen Utility Balcony" [ref=e1323] [cursor=pointer]
                  - button "Kitchen" [ref=e1325] [cursor=pointer]
                  - button "Balcony" [ref=e1327] [cursor=pointer]
                  - button "Dining & Family Hall" [ref=e1329] [cursor=pointer]
                  - button "Living Room" [ref=e1331] [cursor=pointer]
                  - button "Master Bedroom" [ref=e1333] [cursor=pointer]
                  - button "Master Toilet" [ref=e1335] [cursor=pointer]
                  - button "Common Bathroom" [ref=e1337] [cursor=pointer]
                  - button "Internal Passage" [ref=e1339] [cursor=pointer]
                  - button "Bedroom 02" [ref=e1341] [cursor=pointer]
                  - button "Bedroom 02 Balcony" [ref=e1343] [cursor=pointer]
                  - button "Kitchen Utility Balcony" [ref=e1345] [cursor=pointer]
                  - button "Kitchen" [ref=e1347] [cursor=pointer]
                  - button "Balcony" [ref=e1349] [cursor=pointer]
                  - button "Dining & Family Hall" [ref=e1351] [cursor=pointer]
                  - button "Living Room" [ref=e1353] [cursor=pointer]
                  - button "Master Bedroom" [ref=e1355] [cursor=pointer]
                  - button "Master Toilet" [ref=e1357] [cursor=pointer]
                  - button "Common Bathroom" [ref=e1359] [cursor=pointer]
                  - button "Toilet 02" [ref=e1361] [cursor=pointer]
                  - button "Internal Passage" [ref=e1363] [cursor=pointer]
                  - button "Bedroom 02" [ref=e1365] [cursor=pointer]
                  - button "Bedroom 03" [ref=e1367] [cursor=pointer]
                  - button "Master Bedroom Balcony" [ref=e1369] [cursor=pointer]
                  - button "Kitchen Utility Balcony" [ref=e1371] [cursor=pointer]
                  - button "Kitchen" [ref=e1373] [cursor=pointer]
                  - button "Balcony" [ref=e1375] [cursor=pointer]
                  - button "Dining & Family Hall" [ref=e1377] [cursor=pointer]
                  - button "Living Room" [ref=e1379] [cursor=pointer]
                  - button "Master Bedroom" [ref=e1381] [cursor=pointer]
                  - button "Master Toilet" [ref=e1383] [cursor=pointer]
                  - button "Common Bathroom" [ref=e1385] [cursor=pointer]
                  - button "Toilet 02" [ref=e1387] [cursor=pointer]
                  - button "Internal Passage" [ref=e1389] [cursor=pointer]
                  - button "Bedroom 02" [ref=e1391] [cursor=pointer]
                  - button "Bedroom 03" [ref=e1393] [cursor=pointer]
                  - button "Bedroom 02 Balcony" [ref=e1395] [cursor=pointer]
                  - button "Lift" [ref=e1397] [cursor=pointer]
                  - button "Lift" [ref=e1399] [cursor=pointer]
                  - button "Common Circulation 01" [ref=e1401] [cursor=pointer]
                  - button "Common Circulation 02" [ref=e1403] [cursor=pointer]
                  - button "Common Circulation 03" [ref=e1405] [cursor=pointer]
                  - button "MEP / Plumbing Duct 01" [ref=e1407] [cursor=pointer]
                  - button "MEP / Plumbing Duct 02" [ref=e1409] [cursor=pointer]
                  - button "Open-to-Sky Court / Light and Air Void" [ref=e1411] [cursor=pointer]
                  - button "Open-to-Sky Court / Light and Air Void" [ref=e1413] [cursor=pointer]
                - paragraph [ref=e1415]: Select one room, or Ctrl/Shift-click multiple rooms, to lock or regenerate only that region.
              - generic [ref=e1416]:
                - generic [ref=e1417]: Site & Plot
                - generic [ref=e1418]:
                  - generic [ref=e1419]:
                    - generic [ref=e1420]: Plot Width
                    - textbox [disabled] [ref=e1421]: 30000 mm (30.0 m · 98.4′)
                  - generic [ref=e1422]:
                    - generic [ref=e1423]: Plot Depth
                    - textbox [disabled] [ref=e1424]: 40000 mm (40.0 m · 131.2′)
                - generic [ref=e1425]:
                  - generic [ref=e1426]: Road Facing Direction
                  - textbox [disabled] [ref=e1427]: NORTH
                - generic [ref=e1428]:
                  - text: "Total Plot Area:"
                  - strong [ref=e1429]: 12917 sq.ft
                  - text: (1200.0 m²)
              - generic [ref=e1430]:
                - generic [ref=e1431]: Active Floor Info
                - generic [ref=e1432]:
                  - generic [ref=e1433]: Level Name
                  - textbox [disabled] [ref=e1434]: 1ST_FLOOR_PLAN
                - generic [ref=e1435]:
                  - generic [ref=e1436]: Clear Floor Height
                  - textbox [disabled] [ref=e1437]: 3150 mm
                - generic [ref=e1438]:
                  - generic [ref=e1439]: Total Rooms
                  - textbox [disabled] [ref=e1440]: "59"
          - heading "Geometry audit · revision 1" [level=2] [ref=e1441]
          - paragraph [ref=e1442]: INTERNAL GEOMETRY CHECK PASSED
          - paragraph [ref=e1443]: "Measured area delta: 0 mm²"
          - paragraph [ref=e1444]: This software check does not certify structural safety or regulatory compliance. Professional review required.
          - generic [ref=e1445]:
            - button "rooms" [pressed] [ref=e1446] [cursor=pointer]
            - button "walls" [pressed] [ref=e1447] [cursor=pointer]
            - button "openings" [pressed] [ref=e1448] [cursor=pointer]
            - button "stairs" [pressed] [ref=e1449] [cursor=pointer]
            - button "dimensions" [pressed] [ref=e1450] [cursor=pointer]
            - button "grid" [ref=e1451] [cursor=pointer]
          - list
      - generic "CAD layers" [ref=e1452]:
        - button "Walls" [pressed] [ref=e1453] [cursor=pointer]
        - button "Doors/Windows" [pressed] [ref=e1454] [cursor=pointer]
        - button "Staircases" [pressed] [ref=e1455] [cursor=pointer]
        - button "Dimensions" [pressed] [ref=e1456] [cursor=pointer]
        - button "Columns" [ref=e1457] [cursor=pointer]
        - button "Beams" [ref=e1458] [cursor=pointer]
        - button "Furniture" [pressed] [ref=e1459] [cursor=pointer]
```

# Test source

```ts
  18  |     const offset = file.length;
  19  |     file += `${index + 1} 0 obj\n${object}\nendobj\n`;
  20  |     return offset;
  21  |   });
  22  |   const xref = file.length;
  23  |   file += `xref\n0 6\n0000000000 65535 f \n${offsets.map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  24  |   return Buffer.from(file);
  25  | }
  26  | 
  27  | test('welcome renders one scene and scrubs forward and back', async ({ page }, info) => {
  28  |   test.setTimeout(60_000);
  29  |   await page.setViewportSize({ width: 1440, height: 900 });
  30  |   await page.addInitScript(() => {
  31  |     const metrics = { lcp: 0, cls: 0 };
  32  |     Object.assign(window, { rhBrowserMetrics: metrics });
  33  |     new PerformanceObserver(list => {
  34  |       for (const item of list.getEntries()) metrics.lcp = item.startTime;
  35  |     }).observe({ type: 'largest-contentful-paint', buffered: true });
  36  |     new PerformanceObserver(list => {
  37  |       for (const item of list.getEntries() as Array<PerformanceEntry & { hadRecentInput: boolean; value: number }>) {
  38  |         if (!item.hadRecentInput) metrics.cls += item.value;
  39  |       }
  40  |     }).observe({ type: 'layout-shift', buffered: true });
  41  |   });
  42  |   const errors: string[] = [];
  43  |   page.on('pageerror', error => errors.push(error.message));
  44  |   await page.goto(base);
  45  |   const scene = page.getByTestId('cinematic-welcome-canvas-host').locator('canvas');
  46  |   await expect(scene).toBeVisible();
  47  |   const canvas = await scene.elementHandle();
  48  |   await page.screenshot({ path: info.outputPath('01-welcome.png') });
  49  |   const metrics = await page.evaluate(() => (window as Window & { rhBrowserMetrics?: object }).rhBrowserMetrics);
  50  |   console.log('Welcome browser metrics', metrics);
  51  |   await page.getByRole('button', { name: 'Skip intro' }).click();
  52  |   await page.getByTestId('cta-explore-scroll').click();
  53  |   await expect(page.getByTestId('construction-stage-site')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  54  |   await page.getByTestId('construction-stage-walls').focus();
  55  |   await page.keyboard.press('Enter');
  56  |   await expect(page.getByTestId('construction-stage-walls')).toHaveAttribute('aria-pressed', 'true');
  57  |   await expect(page.getByTestId('welcome-construction-scrubber')).toContainText(/Assembly 5[67]%/);
  58  |   await page.mouse.move(920, 450);
  59  |   await page.mouse.wheel(0, 650);
  60  |   await expect(page.getByTestId('construction-stage-landscape')).toHaveAttribute('aria-pressed', 'true');
  61  |   await page.screenshot({ path: info.outputPath('02-construction.png') });
  62  |   await page.mouse.wheel(0, -530);
  63  |   await expect(page.getByTestId('construction-stage-landscape')).toHaveAttribute('aria-pressed', 'false');
  64  |   await page.getByTestId('construction-stage-site').click();
  65  |   await expect(page.getByTestId('construction-stage-site')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  66  |   expect(await scene.evaluate((node, original) => node === original, canvas)).toBe(true);
  67  |   expect(errors).toEqual([]);
  68  | });
  69  | 
  70  | test('mobile landing, project entry and redevelopment allocations', async ({ page }, info) => {
  71  |   await page.setViewportSize({ width: 390, height: 844 });
  72  |   await page.emulateMedia({ reducedMotion: 'reduce' });
  73  |   await page.goto(base);
  74  |   await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  75  |   expect(await page.getByTestId('welcome-scroll-container').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(390);
  76  |   await page.screenshot({ path: info.outputPath('03-mobile-welcome.png') });
  77  |   await page.getByTestId('cta-redevelopment').click();
  78  |   await expect(page.getByTestId('redevelopment-program-panel')).toBeVisible();
  79  |   await page.getByRole('spinbutton', { name: 'Duplex count' }).fill('1');
  80  |   await page.getByRole('spinbutton', { name: 'Triplex count' }).fill('1');
  81  |   await expect(page.getByTestId('redevelopment-feasibility-card')).toBeVisible();
  82  |   await page.screenshot({ path: info.outputPath('04-redevelopment.png') });
  83  |   await page.getByRole('button', { name: 'Continue to Step 02' }).click();
  84  |   await page.getByRole('button', { name: 'Back', exact: true }).click();
  85  |   await expect(page.getByRole('spinbutton', { name: 'Duplex count' })).toHaveValue('1');
  86  |   await expect(page.getByRole('spinbutton', { name: 'Triplex count' })).toHaveValue('1');
  87  |   await page.getByTestId('nav-welcome-home').click();
  88  |   await page.getByTestId('cta-open-existing').click();
  89  |   await expect(page.getByTestId('btn-new-project-from-switcher')).toBeVisible();
  90  | });
  91  | 
  92  | test('production generation, PDF, CAD editing, 3D and verified downloads', async ({ page }, info) => {
  93  |   test.setTimeout(300_000);
  94  |   await page.setViewportSize({ width: 1440, height: 900 });
  95  |   const errors: string[] = [];
  96  |   const failedRequests: string[] = [];
  97  |   page.on('pageerror', error => errors.push(error.message));
  98  |   page.on('response', response => {
  99  |     if (response.status() >= 400 && response.url().startsWith(base)) {
  100 |       failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`);
  101 |     }
  102 |   });
  103 |   await page.goto(base);
  104 |   await page.getByTestId('cta-new-construction').click();
  105 |   await page.getByLabel('Project Title / Estate', { exact: false }).fill('RH Browser Acceptance');
  106 |   await page.screenshot({ path: info.outputPath('05-project-setup.png') });
  107 |   for (const step of [2, 3, 4]) await page.getByRole('button', { name: `Continue to Step 0${step}` }).click();
  108 |   const prompt = page.getByPlaceholder('Describe room layout preferences', { exact: false });
  109 |   await prompt.fill('Prioritize natural light in the living rooms and separate private bedrooms from entry circulation.');
  110 |   const fileInput = page.locator('input[type=file]').first();
  111 |   await fileInput.setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid') });
  112 |   await expect(page.getByText('The selected file does not have a valid PDF signature.')).toBeVisible();
  113 |   await fileInput.setInputFiles({ name: 'survey.pdf', mimeType: 'application/pdf', buffer: surveyPdf() });
  114 |   await expect(page.getByTitle('Reference PDF page preview')).toBeAttached();
  115 |   await expect(page.getByTestId('pdf-conversion-disclaimer')).toContainText('Drawing recognition and model reconstruction require manual input.');
  116 |   await page.getByTestId('checkbox-reference-verified').check();
  117 |   await page.screenshot({ path: info.outputPath('06-brief-and-pdf.png') });
> 118 |   const generation = page.waitForResponse(response => response.url().endsWith('/api/v1/projects/generate'), { timeout: 110_000 });
      |                           ^ TimeoutError: page.waitForResponse: Timeout 110000ms exceeded while waiting for event "response"
  119 |   await page.getByRole('button', { name: 'Generate Architectural Project' }).click();
  120 |   await expect(page.getByRole('dialog', { name: 'Generating your building' })).toBeVisible();
  121 |   await page.screenshot({ path: info.outputPath('07-generation.png') });
  122 |   expect((await generation).status(), 'Production generation route').toBe(200);
  123 |   await expect(page.getByText('Layout score', { exact: false }).first()).toBeVisible({ timeout: 115_000 });
  124 |   await page.screenshot({ path: info.outputPath('08-cad.png') });
  125 |   await page.getByTestId('nav-edit_plan').click();
  126 |   await expect(page.getByTestId('edit-plan-drag-handles')).toBeVisible();
  127 |   const width = page.locator('label:has-text("Width (mm)") input');
  128 |   const initial = await width.inputValue();
  129 |   await page.getByRole('button', { name: '+300mm Out' }).click();
  130 |   const rejection = page.getByRole('region', { name: 'Interactive Plan Editor Studio' }).getByRole('alert');
  131 |   const undo = page.getByTestId('edit-plan-undo');
  132 |   if (await rejection.isVisible()) {
  133 |     await expect(rejection).not.toBeEmpty();
  134 |     await expect(width).toHaveValue(initial);
  135 |   } else {
  136 |     await expect(undo).toBeEnabled();
  137 |     await expect(width).not.toHaveValue(initial);
  138 |     await undo.click();
  139 |     await expect(width).toHaveValue(initial);
  140 |   }
  141 |   await page.screenshot({ path: info.outputPath('08b-plan-editor.png') });
  142 |   await page.getByRole('button', { name: 'Design assistant' }).click();
  143 |   await expect(page.getByRole('complementary', { name: 'RH Planner AI Assistant' })).toContainText('Revision');
  144 |   await page.getByLabel('Review request').fill('Review circulation for the selected floor.');
  145 |   await page.screenshot({ path: info.outputPath('09-assistant.png') });
  146 |   await page.getByRole('button', { name: 'Close assistant' }).click();
  147 |   await page.getByTestId('nav-building_3d').click();
  148 |   await expect(page.getByTestId('building-3d-customizer').locator('canvas').first()).toBeVisible({ timeout: 25000 });
  149 |   await page.getByTestId('floor-mode-isolate').click();
  150 |   await page.locator('[data-testid^="model-level-"]').last().click();
  151 |   await expect(page.locator('[data-testid^="model-level-"]').last()).toHaveAttribute('aria-pressed', 'true');
  152 |   await page.screenshot({ path: info.outputPath('10-building-3d.png') });
  153 |   await page.getByTestId('fixture-opt-casement_timber_win').click();
  154 |   await page.getByTestId('btn-apply-global-skin').click();
  155 |   await expect(page.getByTestId('feedback-notice')).toContainText('Global skin applied');
  156 |   await page.getByRole('button', { name: 'Save project' }).click();
  157 |   await page.setViewportSize({ width: 390, height: 844 });
  158 |   await expect(page.getByTestId('building-3d-customizer').locator('canvas').first()).toBeVisible();
  159 |   await page.screenshot({ path: info.outputPath('11-mobile-3d.png') });
  160 |   await page.setViewportSize({ width: 1440, height: 900 });
  161 |   await page.getByTestId('nav-structural_cad').click();
  162 |   await expect(page.getByText('Professional review required', { exact: true })).toBeVisible();
  163 |   await page.screenshot({ path: info.outputPath('11b-structural-cad.png') });
  164 |   await page.getByTestId('nav-engineering').click();
  165 |   await page.getByRole('tab', { name: 'ETABS Structural Analysis' }).click();
  166 |   await expect(page.getByText('Verified analysis results are unavailable', { exact: false })).toBeVisible();
  167 |   await page.screenshot({ path: info.outputPath('11c-engineering.png') });
  168 |   await page.getByTestId('nav-export').click();
  169 |   await expect(page.getByRole('heading', { name: 'Export Center' })).toBeVisible();
  170 |   await page.screenshot({ path: info.outputPath('12-export.png') });
  171 |   for (const [name, ext, signature] of [
  172 |     ['Download 01 Site Plan pdf', 'pdf', '%PDF-'],
  173 |     ['Download 01 Site Plan dxf', 'dxf', '0'],
  174 |     ['Download 01 Site Plan dwg', 'dwg', 'AC'],
  175 |     ['Download building GLB', 'glb', 'glTF'],
  176 |     ['Download CSI ETABS (.e2k)', 'e2k', ''],
  177 |   ]) {
  178 |     const downloading = page.waitForEvent('download', { timeout: 40_000 });
  179 |     await page.getByRole('button', { name, exact: true }).click();
  180 |     const result = await downloading;
  181 |     expect(result.suggestedFilename()).toMatch(new RegExp(`\\.${ext}$`, 'i'));
  182 |     const path = info.outputPath(result.suggestedFilename());
  183 |     await result.saveAs(path);
  184 |     const bytes = await readFile(path);
  185 |     expect(bytes.length).toBeGreaterThan(30);
  186 |     if (signature) expect(bytes.toString('ascii').trimStart().startsWith(signature)).toBe(true);
  187 |   }
  188 |   const revision = await page.locator('.rh-export-header .rh-kicker').innerText();
  189 |   await page.reload();
  190 |   await page.getByTestId('nav-export').click();
  191 |   await expect(page.locator('.rh-export-header .rh-kicker')).toHaveText(revision);
  192 |   await page.getByTestId('project-switcher-trigger').click();
  193 |   await expect(page.getByTestId('btn-new-project-from-switcher')).toBeVisible();
  194 |   await expect(page.getByTestId('project-switcher-trigger')).toContainText('RH Browser Acceptance');
  195 |   console.log('Failed HTTP responses', failedRequests);
  196 |   expect(errors).toEqual([]);
  197 | });
  198 | 
```