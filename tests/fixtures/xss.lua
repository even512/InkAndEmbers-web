-- Synthetische Fixture: Schadtext in allen Feldern, die die Seite anzeigt (Skript-Tags, Event-Handler, Bidi-Überschreibung,
-- Zero-Width, __proto__/constructor als Schlüssel). Keine echten Spielerdaten. Die Sonderzeichen stehen als Lua-Escapes.

EveNChronicleDB = {
["locale"] = "deDE",
["schema"] = 1,
["chars"] = {
["Player-1-0000EVIL"] = {
["info"] = {
["name"] = "<script>alert(1)</script>\u{202E}Mal\u{200B}ory",
["realm"] = "<img src=x onerror=\"alert(2)\">",
["race"] = "<b>Mensch</b>",
["class"] = "\u{2066}Paladin\u{2069}",
["classFile"] = "PALADIN",
["faction"] = "Alliance",
["firstSeen"] = 1792900000,
["lastSeen"] = 1793132953,
},
["lineCount"] = 3,
["log"] = {
"#~1792900000~1\n0~L~1~1.15.8~61000~16001~deDE~3600\n0~ZN~5~3~5~1~1\n1~SZ~5~<script>alert(3)</script>~2",
},
["snapshots"] = {
["maps"] = {
[5] = { ["name"] = "<iframe src=javascript:alert(4)>" },
},
},
["counters"] = {
["mates"] = {
["__proto__"] = 5,
["constructor"] = 6,
["toString"] = 7,
},
},
},
["__proto__"] = {
["info"] = {
["name"] = "__proto__",
["realm"] = "constructor",
["class"] = "Krieger",
["firstSeen"] = 1792800000,
["lastSeen"] = 1793000000,
},
["lineCount"] = 1,
["log"] = {
"#~1792800000~1\n0~L~1~1.15.8~61000~16001~deDE~3600",
},
},
},
}
