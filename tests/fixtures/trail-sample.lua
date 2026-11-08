-- Synthetische Testdatei (keine echten Spielerdaten): ein Charakter mit Positionsspur und den Log-Zeilen, die die Spur
-- unterbrechen (Login, Ruhestein). Karten: 1429 Elwynn, 1436 Westfall (Forever-uiMapIDs).
EveNChronicleDB = {
["schema"] = 1,
["locale"] = "deDE",
["chars"] = {
["Player-0000-00000001"] = {
["info"] = {
["name"] = "Wegfinder",
["realm"] = "Testreich",
["project"] = 1,
["race"] = "Mensch",
["class"] = "Krieger",
["classFile"] = "WARRIOR",
["faction"] = "Alliance",
["lastSeen"] = 1793002100,
},
["log"] = {
"#~1793000000~1\n0~L~1~11500~70170~11500~deDE~0\n990~HS~8690~Goldshire~1429~4200~6500",
},
["trail"] = {
"#~1793000000~1429\n0~4200~6500\n5~4210~6490\n10~4220~6480\n15~4230~6470~f",
"#~1793000300~1436\n0~5600~3000~l\n4~5610~3010\n8~5620~3020~d\n60~5000~3500\n64~5010~3510",
"#~1793001000~1436\n0~5300~5300\n3~5310~5310",
"#~1793002000~1436\n0~1000~1000\n4~1010~1010",
"#~1793002010~1429\n0~4300~6600~z\n6~4310~6610",
},
},
},
}
