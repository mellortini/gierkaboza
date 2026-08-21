/**
 * AI RPG Engine - Phase 2: Event & Future Simulation Engine
 * 
 * Implementation of the specification:
 * - Phase 1: Global simulation clock (current_time_minutes)
 * - Phase 2: Event queue system with priority heap
 * - Event types: war_battle, war_declared, economic_crisis, npc_move, etc.
 * - Strategic AI: faction planning and event generation
 * - Throttling and hard limits
 */

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const IMPORTANCE_TABLE = {
    "player_death": 1.00,
    "faction_destroyed": 0.95,
    "capital_lost": 0.90,
    "war_declared": 0.80,
    "leader_assassinated": 0.75,
    "reputation_changed": 0.40,
    "conversation_happened": 0.05,
    "item_bought": 0.02,
    "npc_killed": 0.70,
    "location_control_changed": 0.60,
    "gold_changed": 0.25,
    "hp_changed": 0.30,
    "status_effect_added": 0.35,
    "status_effect_removed": 0.20,
    "trade_happened": 0.08,
    "travel_happened": 0.15,
    "item_used": 0.08,
    "item_bought": 0.08,
    "item_sold": 0.06,
    "item_equipped": 0.08,
    "item_unequipped": 0.04,
    "player_healed": 0.10,
    "player_damaged": 0.20,
    "player_downed": 0.65,
    "combat_happened": 0.35,
    "item_looted": 0.12,
    "npc_discovered": 0.18,
    "d20_rolled": 0.08,
    "d20_check_resolved": 0.18,
    "xp_gained": 0.10,
    "quest_accepted": 0.25,
    "quest_completed": 0.45,
    // Phase 2: Event-related changes
    "war_battle": 0.75,
    "war_ended": 0.65,
    "economic_crisis": 0.55,
    "npc_moved": 0.15,
    "assassination_failed": 0.30,
    "rebellion": 0.70,
    "famine": 0.65,
    "plague": 0.70,
    "faction_power_changed": 0.50,
    "faction_resources_changed": 0.45,
    "location_wealth_changed": 0.35,
    "location_stability_changed": 0.40
};

// Default regeneration rates (per minute)
const DEFAULT_REGEN = {
    hp: 1,
    stamina: 2,
    mana: 0.5
};

// Default consumption rates (per minute)
const DEFAULT_CONSUMPTION = {
    hunger: 0.5,
    thirst: 1.0,
    fatigue: 0.3
};

// Status effect thresholds
const STATUS_THRESHOLDS = {
    starving: 80,      // hunger >= 80
    dehydrated: 80,    // thirst >= 80
    exhausted: 80      // fatigue >= 80
};

// Phase 2: Event & Future Simulation Engine limits
const EVENT_LIMITS = {
    MAX_EVENTS_PER_WEEK_REAL_TIME: 180,      // ~25 per day
    MAX_ACTIVE_WARS: 5,
    MAX_QUEUED_EVENTS_HARD_CAP: 1200,
    MAX_PLANNED_EVENTS_PER_FACTION: 8,
    MAX_BATTLES_PER_MONTH: 40
};

const STRATEGIC_UPDATE_INTERVAL = 10080; // 7 days in minutes

// Small deterministic item catalogue used by the starter game and the
// action resolver. Items are data, so saves remain stable as the rules grow.
const ITEM_CATALOG = Object.freeze({
    bread: { id: "bread", name: "Chleb", aliases: ["bread", "chleb"], price: 5, weight: 0.4, type: "food", icon: "/assets/items/bread.png", hungerRestore: 15, description: "Prosty, sycący bochenek." },
    healing_potion: { id: "healing_potion", name: "Mikstura lecznicza", aliases: ["healing potion", "potion", "mikstura", "lecznicza"], price: 25, weight: 0.3, type: "consumable", icon: "/assets/items/healing-potion.png", heal: 30, description: "Przywraca do 30 HP." },
    iron_sword: { id: "iron_sword", name: "Żelazny miecz", aliases: ["iron sword", "sword", "miecz"], price: 75, weight: 3.2, type: "weapon", slot: "weapon", icon: "/assets/items/iron-sword.png", attack: 5, damageDice: "1d8", description: "Solidna broń z wykutym jelcem." },
    leather_armor: { id: "leather_armor", name: "Skórzana zbroja", aliases: ["leather armor", "armor", "zbroja", "zbroję", "zbroje"], price: 60, weight: 5.5, type: "armor", slot: "armor", icon: "/assets/items/leather-armor.png", defense: 2, description: "Lekka ochrona na drogę." },
    wooden_shield: { id: "wooden_shield", name: "Drewniana tarcza", aliases: ["wooden shield", "shield", "tarcza", "tarczę", "tarcze"], price: 45, weight: 2.6, type: "shield", slot: "offhand", icon: "/assets/items/wooden-shield.png", defense: 1, description: "Tarcza z desek, dobra na pierwszy cios." },
    torch: { id: "torch", name: "Pochodnia", aliases: ["torch", "pochodnia", "pochodnie"], price: 3, weight: 0.5, type: "tool", icon: "/assets/items/torch.png", description: "Rozprasza ciemność przez kilka godzin." },
    iron_key: { id: "iron_key", name: "Żelazny klucz", aliases: ["iron key", "key", "klucz"], price: 1, weight: 0.1, type: "quest", icon: "/assets/items/iron-key.png", description: "Pasuje do zamka, którego jeszcze nie znasz." },
    moon_amulet: { id: "moon_amulet", name: "Amulet księżyca", aliases: ["moon amulet", "amulet", "księżyca", "ksiezyca"], price: 120, weight: 0.2, type: "accessory", slot: "accessory", icon: "/assets/items/moon-amulet.png", statBonuses: { wisdom: 1 }, defense: 1, description: "Chłodny kamień reagujący na szepty." },

    // Broń wojownika, szermierza i łucznika walczącego w zwarciu.
    chipped_short_sword: { id: "chipped_short_sword", name: "Wyszczerbiony krótki miecz", aliases: ["chipped short sword", "wyszczerbiony miecz", "krótki miecz"], price: 8, weight: 2.4, type: "weapon", slot: "weapon", icon: "/assets/items/chipped-short-sword.png", attack: 1, damageDice: "1d4", classTags: ["warrior"], description: "Tani złom, który pamięta więcej ucieczek niż zwycięstw." },
    crude_iron_sword: { id: "crude_iron_sword", name: "Toporny żelazny miecz", aliases: ["crude iron sword", "toporny miecz", "żelazny pałasz"], price: 20, weight: 2.8, type: "weapon", slot: "weapon", icon: "/assets/items/crude-iron-sword.png", attack: 2, damageDice: "1d6", classTags: ["warrior"], description: "Nierówne ostrze, ale lepsze niż pięści." },
    militia_sword: { id: "militia_sword", name: "Miecz milicji", aliases: ["militia sword", "miecz milicji"], price: 45, weight: 3, type: "weapon", slot: "weapon", icon: "/assets/items/militia-sword.png", attack: 3, damageDice: "1d6", classTags: ["warrior"], description: "Prosta broń strażnika miejskiego." },
    bronze_falchion: { id: "bronze_falchion", name: "Brązowy falcjon", aliases: ["bronze falchion", "falcjon", "brązowy miecz"], price: 80, weight: 3.3, type: "weapon", slot: "weapon", icon: "/assets/items/bronze-falchion.png", attack: 4, damageDice: "1d8", classTags: ["warrior"], description: "Szerokie ostrze do ciężkich, zamachowych cięć." },
    steel_longsword: { id: "steel_longsword", name: "Stalowy długi miecz", aliases: ["steel longsword", "długi miecz", "stalowy miecz"], price: 130, weight: 3.5, type: "weapon", slot: "weapon", icon: "/assets/items/steel-longsword.png", attack: 6, damageDice: "1d8", classTags: ["warrior"], description: "Dobrze wyważona broń dla doświadczonego wojownika." },
    silver_rapier: { id: "silver_rapier", name: "Srebrna rapierka", aliases: ["silver rapier", "rapierka", "srebrny rapier"], price: 190, weight: 2, type: "weapon", slot: "weapon", icon: "/assets/items/silver-rapier.png", attack: 7, damageDice: "1d8", statBonuses: { dexterity: 1 }, classTags: ["rogue", "ranger"], description: "Lekka broń nagradzająca precyzję zamiast siły." },
    blacksteel_bastard_sword: { id: "blacksteel_bastard_sword", name: "Czarnostalowy bastard", aliases: ["blacksteel bastard sword", "bastard", "czarnostalowy miecz"], price: 280, weight: 4.8, type: "weapon", slot: "weapon", icon: "/assets/items/blacksteel-bastard-sword.png", attack: 9, damageDice: "1d10", statBonuses: { strength: 1 }, classTags: ["warrior"], description: "Półtorak o ponurym połysku i ciężarze godnym najemnika." },
    frost_rune_sword: { id: "frost_rune_sword", name: "Miecz runicznego mrozu", aliases: ["frost rune sword", "miecz mrozu", "runiczny miecz"], price: 420, weight: 3.8, type: "weapon", slot: "weapon", icon: "/assets/items/frost-rune-sword.png", attack: 11, damageDice: "1d10", statBonuses: { intelligence: 1 }, classTags: ["warrior", "mage"], description: "Runy na głowni zostawiają kryształowy szron na trafionym celu." },
    sun_gilded_greatsword: { id: "sun_gilded_greatsword", name: "Słońcem pozłacany zweihänder", aliases: ["sun gilded greatsword", "pozłacany wielki miecz", "zweihänder"], price: 700, weight: 6.5, type: "weapon", slot: "weapon", icon: "/assets/items/sun-gilded-greatsword.png", attack: 14, damageDice: "2d6", statBonuses: { strength: 2 }, classTags: ["warrior"], description: "Ogromne ostrze dla tych, którzy potrafią udźwignąć jego legendę." },
    starforged_blade: { id: "starforged_blade", name: "Gwiezdnie wykute ostrze", aliases: ["starforged blade", "gwiezdne ostrze", "miecz gwiazd"], price: 1200, weight: 4.6, type: "weapon", slot: "weapon", icon: "/assets/items/starforged-blade.png", attack: 18, damageDice: "2d8", statBonuses: { strength: 2, dexterity: 1 }, classTags: ["warrior", "ranger"], description: "Metal spadł z nieba i do dziś cicho drży w dłoni." },

    cracked_twig_bow: { id: "cracked_twig_bow", name: "Wyszczerbiony łuk z gałęzi", aliases: ["cracked twig bow", "łuk z gałęzi", "wyszczerbiony łuk"], price: 8, weight: 1, type: "weapon", slot: "weapon", icon: "/assets/items/cracked-twig-bow.png", attack: 1, damageDice: "1d4", classTags: ["ranger"], description: "Ledwie trzyma cięciwę, ale pozwala zacząć polowanie." },
    simple_hunting_bow: { id: "simple_hunting_bow", name: "Prosty łuk myśliwski", aliases: ["simple hunting bow", "prosty łuk", "łuk myśliwski"], price: 25, weight: 1.5, type: "weapon", slot: "weapon", icon: "/assets/items/simple-hunting-bow.png", attack: 2, damageDice: "1d6", classTags: ["ranger"], description: "Niedrogi łuk do polowania na drobną zwierzynę." },
    militia_shortbow: { id: "militia_shortbow", name: "Krótki łuk milicji", aliases: ["militia shortbow", "krótki łuk milicji", "łuk milicji"], price: 50, weight: 1.8, type: "weapon", slot: "weapon", icon: "/assets/items/militia-shortbow.png", attack: 3, damageDice: "1d6", classTags: ["ranger", "warrior"], description: "Prosta broń patrolowa, łatwa do użycia w ciasnych uliczkach." },
    yew_longbow: { id: "yew_longbow", name: "Cisowy długi łuk", aliases: ["yew longbow", "cisowy długi łuk", "długi łuk"], price: 100, weight: 2.2, type: "weapon", slot: "weapon", icon: "/assets/items/yew-longbow.png", attack: 5, damageDice: "1d8", classTags: ["ranger"], description: "Sprężyste cisowe drewno pozwala razić cel z większej odległości." },
    recurved_ranger_bow: { id: "recurved_ranger_bow", name: "Refleksyjny łuk tropiciela", aliases: ["recurved ranger bow", "refleksyjny łuk", "łuk tropiciela"], price: 180, weight: 1.6, type: "weapon", slot: "weapon", icon: "/assets/items/recurved-ranger-bow.png", attack: 7, damageDice: "1d8", statBonuses: { dexterity: 1 }, classTags: ["ranger"], description: "Podwójnie wygięte ramiona zwiększają siłę bez zbędnego ciężaru." },
    silverleaf_bow: { id: "silverleaf_bow", name: "Srebrnolistny łuk", aliases: ["silverleaf bow", "srebrnolistny łuk", "srebrny łuk"], price: 300, weight: 1.4, type: "weapon", slot: "weapon", icon: "/assets/items/silverleaf-bow.png", attack: 9, damageDice: "1d10", statBonuses: { dexterity: 2 }, classTags: ["ranger"], description: "Jego jasne drewno nie szeleszcząc prowadzi strzałę przez liście." },
    blackwood_warbow: { id: "blackwood_warbow", name: "Czarnodrzewny łuk wojenny", aliases: ["blackwood warbow", "czarnodrzewny łuk", "łuk wojenny"], price: 450, weight: 3.8, type: "weapon", slot: "weapon", icon: "/assets/items/blackwood-warbow.png", attack: 11, damageDice: "1d10", statBonuses: { strength: 1 }, classTags: ["ranger", "warrior"], description: "Ciężki łuk do przebijania pancerzy i tarcz." },
    stormstring_bow: { id: "stormstring_bow", name: "Łuk burzowej cięciwy", aliases: ["stormstring bow", "łuk burzy", "burzowa cięciwa"], price: 650, weight: 2, type: "weapon", slot: "weapon", icon: "/assets/items/stormstring-bow.png", attack: 13, damageDice: "2d6", statBonuses: { dexterity: 2, intelligence: 1 }, classTags: ["ranger", "mage"], description: "Cięciwa trzaska błękitnym światłem, gdy strzała opuszcza łuk." },
    sun_gilded_greatbow: { id: "sun_gilded_greatbow", name: "Słońcem pozłacany wielki łuk", aliases: ["sun gilded greatbow", "pozłacany wielki łuk", "wielki łuk słońca"], price: 950, weight: 4.8, type: "weapon", slot: "weapon", icon: "/assets/items/sun-gilded-greatbow.png", attack: 16, damageDice: "2d6", statBonuses: { strength: 2, dexterity: 1 }, classTags: ["ranger", "warrior"], description: "Złote okucia skupiają ciepło dnia w każdym wypuszczonym pocisku." },
    starforged_celestial_bow: { id: "starforged_celestial_bow", name: "Gwiezdnie wykuty łuk niebios", aliases: ["starforged celestial bow", "gwiezdny łuk", "łuk niebios"], price: 1600, weight: 2.4, type: "weapon", slot: "weapon", icon: "/assets/items/starforged-celestial-bow.png", attack: 20, damageDice: "2d8", statBonuses: { dexterity: 3, wisdom: 1 }, classTags: ["ranger"], description: "Jego cięciwa jest cienka jak promień gwiazdy, a strzała znika w nocnym blasku." },

    patched_jerkin: { id: "patched_jerkin", name: "Połatany kaftan", aliases: ["patched jerkin", "połatany kaftan", "kaftan"], price: 10, weight: 2, type: "armor", slot: "armor", icon: "/assets/items/patched-jerkin.png", defense: 0, classTags: ["common"], description: "Ochrona bardziej przed wiatrem niż ostrzem." },
    cracked_hide_vest: { id: "cracked_hide_vest", name: "Pęknięta kamizelka z chruściny", aliases: ["cracked hide vest", "kamizelka ze skóry", "skórzana kamizelka"], price: 25, weight: 3.5, type: "armor", slot: "armor", icon: "/assets/items/cracked-hide-vest.png", defense: 1, classTags: ["warrior", "ranger"], description: "Sztywna i niedroga, choć nieprzyjemnie pachnie dymem." },
    leather_cuirass: { id: "leather_cuirass", name: "Skórzany napierśnik", aliases: ["leather cuirass", "skórzany napierśnik", "napierśnik"], price: 60, weight: 5.2, type: "armor", slot: "armor", icon: "/assets/items/leather-cuirass.png", defense: 2, classTags: ["warrior", "ranger"], description: "Lekki, praktyczny pancerz na pierwszą wyprawę." },
    studded_leather: { id: "studded_leather", name: "Ćwiekowana skóra", aliases: ["studded leather", "ćwiekowana zbroja", "ćwiekowana skóra"], price: 100, weight: 6, type: "armor", slot: "armor", icon: "/assets/items/studded-leather.png", defense: 3, statBonuses: { dexterity: 1 }, classTags: ["ranger", "rogue"], description: "Skóra wzmocniona metalowymi ćwiekami, nie krępuje ruchów." },
    chainmail_shirt: { id: "chainmail_shirt", name: "Kolczuga", aliases: ["chainmail shirt", "kolczuga", "łańcuchowa zbroja"], price: 180, weight: 9, type: "armor", slot: "armor", icon: "/assets/items/chainmail-shirt.png", defense: 4, classTags: ["warrior"], description: "Tysiące kółek, które zatrzymują ostrze kosztem ciężaru." },
    polished_scale_armor: { id: "polished_scale_armor", name: "Polerowana łuskowa zbroja", aliases: ["polished scale armor", "łuskowa zbroja", "polerowana łuska"], price: 300, weight: 10, type: "armor", slot: "armor", icon: "/assets/items/polished-scale-armor.png", defense: 5, statBonuses: { strength: 1 }, classTags: ["warrior"], description: "Nachodzące na siebie łuski odbijają światło i stal." },
    dark_ranger_coat: { id: "dark_ranger_coat", name: "Płaszcz mrocznego tropiciela", aliases: ["dark ranger coat", "płaszcz tropiciela", "mroczny płaszcz"], price: 450, weight: 6.5, type: "armor", slot: "armor", icon: "/assets/items/dark-ranger-coat.png", defense: 4, statBonuses: { dexterity: 2 }, classTags: ["ranger", "rogue"], description: "Ciemny płaszcz, w którym łatwo zniknąć między drzewami." },
    arcane_battle_robe: { id: "arcane_battle_robe", name: "Bojowa szata arkanów", aliases: ["arcane battle robe", "szata arkanów", "bojowa szata"], price: 550, weight: 3.5, type: "armor", slot: "armor", icon: "/assets/items/arcane-battle-robe.png", defense: 3, statBonuses: { intelligence: 2, wisdom: 1 }, classTags: ["mage"], description: "Materiał reaguje na zaklęcia i lekko unosi się nad ziemią." },
    royal_plate_armor: { id: "royal_plate_armor", name: "Królewska zbroja płytowa", aliases: ["royal plate armor", "królewska zbroja", "zbroja płytowa"], price: 850, weight: 14, type: "armor", slot: "armor", icon: "/assets/items/royal-plate-armor.png", defense: 8, statBonuses: { strength: 2 }, classTags: ["warrior"], description: "Pancerz dla dowódcy, który nie zamierza klękać." },
    dragonforged_plate: { id: "dragonforged_plate", name: "Smocza zbroja płytowa", aliases: ["dragonforged plate", "smocza zbroja", "smocza płyta"], price: 1500, weight: 16, type: "armor", slot: "armor", icon: "/assets/items/dragonforged-plate.png", defense: 11, statBonuses: { strength: 3, constitution: 1 }, classTags: ["warrior"], description: "Płyty zahartowane w smoczym ogniu wytrzymują ciosy, które kruszą stal." },

    cloth_handwraps: { id: "cloth_handwraps", name: "Płócienne owijki", aliases: ["cloth handwraps", "płócienne owijki", "owijki"], price: 5, weight: 0.2, type: "gloves", slot: "gloves", icon: "/assets/items/cloth-handwraps.png", defense: 0, classTags: ["common"], description: "Ręce owinięte materiałem, żeby nie pękały od pracy." },
    worn_leather_gloves: { id: "worn_leather_gloves", name: "Wytarte rękawice skórzane", aliases: ["worn leather gloves", "skórzane rękawice", "rękawice"], price: 18, weight: 0.5, type: "gloves", slot: "gloves", icon: "/assets/items/worn-leather-gloves.png", defense: 0, statBonuses: { dexterity: 1 }, classTags: ["common", "ranger"], description: "Stare, ale wciąż lepsze niż gołe dłonie." },
    hunter_fingerless_gloves: { id: "hunter_fingerless_gloves", name: "Rękawice myśliwego", aliases: ["hunter fingerless gloves", "rękawice myśliwego", "bezpalczaste rękawice"], price: 55, weight: 0.4, type: "gloves", slot: "gloves", icon: "/assets/items/hunter-fingerless-gloves.png", attack: 1, defense: 0, statBonuses: { dexterity: 1 }, classTags: ["ranger", "rogue"], description: "Pozostawiają palce wolne do pracy z cięciwą i nożem." },
    reinforced_hide_bracers: { id: "reinforced_hide_bracers", name: "Wzmocnione karwasze", aliases: ["reinforced hide bracers", "wzmocnione karwasze", "karwasze"], price: 95, weight: 1, type: "gloves", slot: "gloves", icon: "/assets/items/reinforced-hide-bracers.png", defense: 1, statBonuses: { strength: 1 }, classTags: ["warrior", "ranger"], description: "Skóra i nitowane paski osłaniają nadgarstki przed ciosem." },
    iron_knuckle_gloves: { id: "iron_knuckle_gloves", name: "Żelazne rękawice z kastetami", aliases: ["iron knuckle gloves", "żelazne kastety", "rękawice z kastetami"], price: 160, weight: 1.8, type: "gloves", slot: "gloves", icon: "/assets/items/iron-knuckle-gloves.png", attack: 2, defense: 1, statBonuses: { strength: 1 }, classTags: ["warrior"], description: "Wzmocnione kostki sprawiają, że pięść brzmi jak młot." },
    duelist_gauntlets: { id: "duelist_gauntlets", name: "Rękawice pojedynkowicza", aliases: ["duelist gauntlets", "rękawice pojedynkowicza", "rękawice szermierza"], price: 260, weight: 1.2, type: "gloves", slot: "gloves", icon: "/assets/items/duelist-gauntlets.png", defense: 2, statBonuses: { dexterity: 2 }, classTags: ["warrior", "rogue"], description: "Cienkie metalowe płytki nie przeszkadzają w precyzyjnych ruchach." },
    ranger_leafgloves: { id: "ranger_leafgloves", name: "Liściaste rękawice tropiciela", aliases: ["ranger leaf gloves", "liściaste rękawice", "rękawice tropiciela"], price: 380, weight: 0.7, type: "gloves", slot: "gloves", icon: "/assets/items/ranger-leafgloves.png", defense: 1, statBonuses: { dexterity: 2, wisdom: 1 }, classTags: ["ranger"], description: "Miękka zieleń kamufluje dłonie nawet przy naciąganiu łuku." },
    arcane_rune_gloves: { id: "arcane_rune_gloves", name: "Runiczne rękawice arkanisty", aliases: ["arcane rune gloves", "runiczne rękawice", "rękawice arkanisty"], price: 520, weight: 0.6, type: "gloves", slot: "gloves", icon: "/assets/items/arcane-rune-gloves.png", defense: 1, statBonuses: { intelligence: 2 }, classTags: ["mage"], description: "Runy na dłoniach rozświetlają się przy każdym zaklęciu." },
    royal_silver_gauntlets: { id: "royal_silver_gauntlets", name: "Srebrne rękawice królewskie", aliases: ["royal silver gauntlets", "srebrne rękawice królewskie", "królewskie rękawice"], price: 900, weight: 2.5, type: "gloves", slot: "gloves", icon: "/assets/items/royal-silver-gauntlets.png", defense: 4, statBonuses: { strength: 2 }, classTags: ["warrior"], description: "Ciężkie, zdobione rękawice noszone przez gwardię koronną." },
    dragonclaw_gauntlets: { id: "dragonclaw_gauntlets", name: "Smocze szpony", aliases: ["dragonclaw gauntlets", "smocze szpony", "smocze rękawice"], price: 1600, weight: 3, type: "gloves", slot: "gloves", icon: "/assets/items/dragonclaw-gauntlets.png", attack: 3, defense: 5, statBonuses: { strength: 3 }, classTags: ["warrior"], description: "Pazury na stalowych palcach nie są wyłącznie ozdobą." },

    burlap_trousers: { id: "burlap_trousers", name: "Jutowe spodnie", aliases: ["burlap trousers", "jutowe spodnie", "spodnie z juty"], price: 5, weight: 0.8, type: "legs", slot: "legs", icon: "/assets/items/burlap-trousers.png", defense: 0, classTags: ["common"], description: "Szorstkie, tanie i całkiem niegodne pojedynku." },
    worn_travel_pants: { id: "worn_travel_pants", name: "Wytarte spodnie podróżne", aliases: ["worn travel pants", "spodnie podróżne", "wytarte spodnie"], price: 16, weight: 1, type: "legs", slot: "legs", icon: "/assets/items/worn-travel-pants.png", statBonuses: { dexterity: 1 }, classTags: ["common", "ranger"], description: "Wygodne spodnie z kieszeniami na drobiazgi." },
    leather_leggings: { id: "leather_leggings", name: "Skórzane nogawice", aliases: ["leather leggings", "skórzane nogawice", "nogawice"], price: 50, weight: 2.4, type: "legs", slot: "legs", icon: "/assets/items/leather-leggings.png", defense: 1, classTags: ["warrior", "ranger"], description: "Skóra chroni kolana bez blokowania kroku." },
    studded_hunter_leggings: { id: "studded_hunter_leggings", name: "Ćwiekowane nogawice łowcy", aliases: ["studded hunter leggings", "nogawice łowcy", "ćwiekowane nogawice"], price: 90, weight: 3, type: "legs", slot: "legs", icon: "/assets/items/studded-hunter-leggings.png", defense: 2, statBonuses: { dexterity: 1 }, classTags: ["ranger"], description: "Wzmocnione uda przydają się podczas długich marszów i zasadzki." },
    chainmail_chausses: { id: "chainmail_chausses", name: "Kolczane nogawice", aliases: ["chainmail chausses", "kolczane nogawice", "kolczuga na nogi"], price: 170, weight: 5.5, type: "legs", slot: "legs", icon: "/assets/items/chainmail-chausses.png", defense: 3, classTags: ["warrior"], description: "Ciężka siatka chroniąca nogi przed cięciem." },
    steel_plated_greaves: { id: "steel_plated_greaves", name: "Stalowe nagolenniki", aliases: ["steel plated greaves", "stalowe nagolenniki", "nagolenniki"], price: 280, weight: 7, type: "legs", slot: "legs", icon: "/assets/items/steel-plated-greaves.png", defense: 5, classTags: ["warrior"], description: "Solidne płyty dla wojownika, który nie cofa nogi." },
    forest_ranger_leggings: { id: "forest_ranger_leggings", name: "Nogawice leśnego tropiciela", aliases: ["forest ranger leggings", "nogawice tropiciela", "leśne nogawice"], price: 400, weight: 2.8, type: "legs", slot: "legs", icon: "/assets/items/forest-ranger-leggings.png", defense: 2, statBonuses: { dexterity: 2 }, classTags: ["ranger"], description: "Zielone warstwy nie szeleszczą nawet wśród suchego igliwia." },
    arcane_blue_trousers: { id: "arcane_blue_trousers", name: "Błękitne spodnie arkanów", aliases: ["arcane blue trousers", "błękitne spodnie arkanów", "spodnie maga"], price: 520, weight: 2.2, type: "legs", slot: "legs", icon: "/assets/items/arcane-blue-trousers.png", defense: 2, statBonuses: { intelligence: 2 }, classTags: ["mage"], description: "Materiał jest lekki jak dym i chłodny jak nocna magia." },
    royal_silver_leg_armor: { id: "royal_silver_leg_armor", name: "Srebrny pancerz nóg", aliases: ["royal silver leg armor", "srebrny pancerz nóg", "królewskie nogawice"], price: 850, weight: 8, type: "legs", slot: "legs", icon: "/assets/items/royal-silver-leg-armor.png", defense: 6, statBonuses: { strength: 1 }, classTags: ["warrior"], description: "Wypolerowane płyty połyskują jak herb na królewskim sztandarze." },
    dragon_scale_greaves: { id: "dragon_scale_greaves", name: "Smocze łuskowe nagolenniki", aliases: ["dragon scale greaves", "smocze nagolenniki", "smocze łuski na nogi"], price: 1500, weight: 6, type: "legs", slot: "legs", icon: "/assets/items/dragon-scale-greaves.png", defense: 8, statBonuses: { strength: 2, dexterity: 1 }, classTags: ["warrior", "ranger"], description: "Łuski są lekkie jak skóra, ale twarde jak hartowana stal." },

    cloth_shoes: { id: "cloth_shoes", name: "Płócienne trzewiki", aliases: ["cloth shoes", "płócienne trzewiki", "trzewiki"], price: 4, weight: 0.4, type: "boots", slot: "boots", icon: "/assets/items/cloth-shoes.png", defense: 0, classTags: ["common"], description: "Ledwie chronią stopy przed zimnem i kamieniami." },
    cracked_leather_boots: { id: "cracked_leather_boots", name: "Pęknięte skórzane buty", aliases: ["cracked leather boots", "pęknięte buty", "skórzane buty"], price: 15, weight: 0.8, type: "boots", slot: "boots", statBonuses: { dexterity: 1 }, icon: "/assets/items/cracked-leather-boots.png", classTags: ["common"], description: "Nadal nadają się do drogi, choć przemakają przy każdej kałuży." },
    sturdy_travel_boots: { id: "sturdy_travel_boots", name: "Solidne buty podróżne", aliases: ["sturdy travel boots", "solidne buty", "buty podróżne"], price: 40, weight: 1.2, type: "boots", slot: "boots", icon: "/assets/items/sturdy-travel-boots.png", defense: 1, classTags: ["warrior", "ranger"], description: "Wygodne podeszwy na długą drogę." },
    hunter_softstep_boots: { id: "hunter_softstep_boots", name: "Ciche buty łowcy", aliases: ["hunter softstep boots", "ciche buty", "buty łowcy"], price: 80, weight: 0.8, type: "boots", slot: "boots", icon: "/assets/items/hunter-softstep-boots.png", defense: 1, statBonuses: { dexterity: 2 }, classTags: ["ranger", "rogue"], description: "Miękka podeszwa nie zdradza kroku na mchu." },
    iron_toed_boots: { id: "iron_toed_boots", name: "Buty z żelaznym noskiem", aliases: ["iron toed boots", "buty z żelaznym noskiem", "żelazne buty"], price: 140, weight: 2.5, type: "boots", slot: "boots", icon: "/assets/items/iron-toed-boots.png", defense: 2, statBonuses: { strength: 1 }, classTags: ["warrior"], description: "Ciężkie, ale potrafią zakończyć rozmowę jednym kopnięciem." },
    steel_greaves_boots: { id: "steel_greaves_boots", name: "Stalowe sabatony", aliases: ["steel greaves boots", "stalowe sabatony", "sabatony"], price: 250, weight: 4, type: "boots", slot: "boots", icon: "/assets/items/steel-greaves-boots.png", defense: 4, classTags: ["warrior"], description: "Pancerne buty gwardzisty." },
    foreststrider_boots: { id: "foreststrider_boots", name: "Buty leśnego wędrowca", aliases: ["foreststrider boots", "buty leśnego wędrowca", "leśne buty"], price: 360, weight: 1.5, type: "boots", slot: "boots", icon: "/assets/items/foreststrider-boots.png", defense: 2, statBonuses: { dexterity: 2 }, classTags: ["ranger"], description: "Dopasowują się do nierówności kamieni i korzeni." },
    arcane_blue_boots: { id: "arcane_blue_boots", name: "Błękitne buty maga", aliases: ["arcane blue boots", "błękitne buty maga", "buty maga"], price: 500, weight: 1.2, type: "boots", slot: "boots", icon: "/assets/items/arcane-blue-boots.png", defense: 2, statBonuses: { intelligence: 1 }, classTags: ["mage"], description: "Runiczna podeszwa zostawia na śniegu niebieskie iskry." },
    royal_silver_sabatons: { id: "royal_silver_sabatons", name: "Królewskie srebrne sabatony", aliases: ["royal silver sabatons", "srebrne sabatony", "królewskie buty"], price: 800, weight: 4.5, type: "boots", slot: "boots", icon: "/assets/items/royal-silver-sabatons.png", defense: 6, statBonuses: { strength: 1 }, classTags: ["warrior"], description: "Każdy krok brzmi jak rozkaz na paradzie." },
    dragonfire_boots: { id: "dragonfire_boots", name: "Smoczy ogień pod stopami", aliases: ["dragonfire boots", "smocze buty", "buty smoczego ognia"], price: 1450, weight: 3, type: "boots", slot: "boots", icon: "/assets/items/dragonfire-boots.png", defense: 5, statBonuses: { strength: 2, dexterity: 1 }, classTags: ["warrior", "ranger"], description: "Płomień nie parzy właściciela, ale ostrzega wszystkich wokół." },

    crooked_branch_staff: { id: "crooked_branch_staff", name: "Krzywy kostur z gałęzi", aliases: ["crooked branch staff", "krzywy kostur", "kostur z gałęzi"], price: 8, weight: 0.8, type: "weapon", slot: "weapon", icon: "/assets/items/crooked-branch-staff.png", attack: 1, damageDice: "1d4", statBonuses: { intelligence: 1 }, classTags: ["mage"], description: "Pierwszy kostur ucznia, bardziej pomocny w marszu niż w walce." },
    ashwood_staff: { id: "ashwood_staff", name: "Kostur jesionowy", aliases: ["ashwood staff", "kostur jesionowy", "jesionowy kostur"], price: 25, weight: 1.2, type: "weapon", slot: "weapon", icon: "/assets/items/ashwood-staff.png", attack: 2, damageDice: "1d6", statBonuses: { intelligence: 1 }, classTags: ["mage"], description: "Gładkie drewno dobrze przewodzi prostą magię." },
    apprentice_copper_staff: { id: "apprentice_copper_staff", name: "Miedziany kostur czeladnika", aliases: ["apprentice copper staff", "miedziany kostur", "kostur czeladnika"], price: 60, weight: 1.4, type: "weapon", slot: "weapon", icon: "/assets/items/apprentice-copper-staff.png", attack: 3, damageDice: "1d6", statBonuses: { intelligence: 2 }, classTags: ["mage"], description: "Miedziana końcówka pozwala utrzymać zaklęcie w ryzach." },
    emerald_nature_staff: { id: "emerald_nature_staff", name: "Szmaragdowy kostur natury", aliases: ["emerald nature staff", "szmaragdowy kostur", "kostur natury"], price: 120, weight: 1.6, type: "weapon", slot: "weapon", icon: "/assets/items/emerald-nature-staff.png", attack: 4, damageDice: "1d8", statBonuses: { wisdom: 2 }, classTags: ["mage", "ranger"], description: "Żywe pnącza oplatają drewno i reagują na leśne duchy." },
    silver_moon_staff: { id: "silver_moon_staff", name: "Srebrny kostur księżyca", aliases: ["silver moon staff", "srebrny kostur", "kostur księżyca"], price: 220, weight: 1.8, type: "weapon", slot: "weapon", icon: "/assets/items/silver-moon-staff.png", attack: 6, damageDice: "1d8", statBonuses: { wisdom: 2, intelligence: 1 }, classTags: ["mage"], description: "Półksiężyc na szczycie świeci mocniej w noc bez chmur." },
    stormcaller_staff: { id: "stormcaller_staff", name: "Kostur wzywający burzę", aliases: ["stormcaller staff", "kostur burzy", "wzywający burzę"], price: 360, weight: 2, type: "weapon", slot: "weapon", icon: "/assets/items/stormcaller-staff.png", attack: 8, damageDice: "1d10", statBonuses: { intelligence: 2 }, classTags: ["mage"], description: "Kryształ trzaska elektrycznością przed każdym zaklęciem." },
    black_rune_staff: { id: "black_rune_staff", name: "Czarny kostur run", aliases: ["black rune staff", "czarny kostur", "kostur run"], price: 520, weight: 2.2, type: "weapon", slot: "weapon", icon: "/assets/items/black-rune-staff.png", attack: 10, damageDice: "1d10", statBonuses: { intelligence: 3 }, classTags: ["mage"], description: "Runy są stare, a ich właściciel nie zawsze jest oczywisty." },
    ancient_druid_staff: { id: "ancient_druid_staff", name: "Kostur pradawnego druida", aliases: ["ancient druid staff", "kostur druida", "pradawny kostur"], price: 760, weight: 2.3, type: "weapon", slot: "weapon", icon: "/assets/items/ancient-druid-staff.png", attack: 12, damageDice: "2d6", statBonuses: { wisdom: 3 }, classTags: ["mage", "ranger"], description: "Wyrósł z drzewa, które pamięta pierwsze ścieżki świata." },
    archmage_staff: { id: "archmage_staff", name: "Kostur arcymaga", aliases: ["archmage staff", "kostur arcymaga", "arcymag"], price: 1100, weight: 2, type: "weapon", slot: "weapon", icon: "/assets/items/archmage-staff.png", attack: 15, damageDice: "2d6", statBonuses: { intelligence: 4 }, classTags: ["mage"], description: "Pływający kryształ skupia zaklęcia na odległość." },
    cosmic_crystal_staff: { id: "cosmic_crystal_staff", name: "Kosmiczny kostur kryształowy", aliases: ["cosmic crystal staff", "kosmiczny kostur", "kostur kryształowy"], price: 1800, weight: 2.5, type: "weapon", slot: "weapon", icon: "/assets/items/cosmic-crystal-staff.png", attack: 20, damageDice: "2d8", statBonuses: { intelligence: 4, wisdom: 2 }, classTags: ["mage"], description: "W jego krysztale wiruje maleńka, niemożliwa noc." },

    floppy_cloth_cap: { id: "floppy_cloth_cap", name: "Miękka płócienna czapka", aliases: ["floppy cloth cap", "płócienna czapka", "czapka"], price: 5, weight: 0.3, type: "head", slot: "head", icon: "/assets/items/floppy-cloth-cap.png", defense: 0, classTags: ["common"], description: "Chroni przed słońcem, ale nie przed mieczem." },
    patched_wool_hood: { id: "patched_wool_hood", name: "Połatany wełniany kaptur", aliases: ["patched wool hood", "wełniany kaptur", "połatany kaptur"], price: 15, weight: 0.5, type: "head", slot: "head", icon: "/assets/items/patched-wool-hood.png", defense: 0, statBonuses: { wisdom: 1 }, classTags: ["common"], description: "Ciepły i skromny, idealny na początek podróży." },
    simple_leather_cap: { id: "simple_leather_cap", name: "Prosta skórzana czapka", aliases: ["simple leather cap", "skórzana czapka", "czapka skórzana"], price: 35, weight: 0.8, type: "head", slot: "head", icon: "/assets/items/simple-leather-cap.png", defense: 1, classTags: ["warrior", "ranger"], description: "Twarda skóra osłania skroń przed przypadkowym uderzeniem." },
    green_ranger_hood: { id: "green_ranger_hood", name: "Zielony kaptur tropiciela", aliases: ["green ranger hood", "zielony kaptur", "kaptur tropiciela"], price: 75, weight: 0.6, type: "head", slot: "head", icon: "/assets/items/green-ranger-hood.png", defense: 1, statBonuses: { dexterity: 1 }, classTags: ["ranger"], description: "Zlewa się z koronami drzew i nie ogranicza widzenia." },
    iron_skullcap: { id: "iron_skullcap", name: "Żelazna szłomka", aliases: ["iron skullcap", "żelazna szłomka", "szłomka"], price: 120, weight: 1.5, type: "head", slot: "head", icon: "/assets/items/iron-skullcap.png", defense: 2, classTags: ["warrior"], description: "Niewyszukana, ale ratuje głowę przed pałką." },
    steel_knight_helmet: { id: "steel_knight_helmet", name: "Stalowy hełm rycerski", aliases: ["steel knight helmet", "stalowy hełm", "hełm rycerski"], price: 220, weight: 2.8, type: "head", slot: "head", icon: "/assets/items/steel-knight-helmet.png", defense: 4, statBonuses: { strength: 1 }, classTags: ["warrior"], description: "Zamykana przyłbica i stalowa ochrona karku." },
    silver_circlet: { id: "silver_circlet", name: "Srebrny diadem", aliases: ["silver circlet", "srebrny diadem", "diadem"], price: 380, weight: 0.3, type: "head", slot: "head", icon: "/assets/items/silver-circlet.png", defense: 1, statBonuses: { wisdom: 2 }, classTags: ["mage", "ranger"], description: "Cienka obręcz, w której słychać cichy szum myśli." },
    starry_wizard_hat: { id: "starry_wizard_hat", name: "Gwiaździsty kapelusz czarodzieja", aliases: ["starry wizard hat", "kapelusz czarodzieja", "gwiaździsty kapelusz"], price: 520, weight: 0.5, type: "head", slot: "head", icon: "/assets/items/starry-wizard-hat.png", defense: 1, statBonuses: { intelligence: 2 }, classTags: ["mage"], description: "Pod rondem świecą drobne gwiazdy, których nie ma na niebie." },
    royal_gold_crown_helm: { id: "royal_gold_crown_helm", name: "Złoty hełm koronny", aliases: ["royal gold crown helm", "złoty hełm koronny", "hełm koronny"], price: 900, weight: 3.2, type: "head", slot: "head", icon: "/assets/items/royal-gold-crown-helm.png", defense: 5, statBonuses: { strength: 1, charisma: 2 }, classTags: ["warrior"], description: "Korona i hełm w jednym — trudno go nosić bez pewności siebie." },
    dragon_horned_helm: { id: "dragon_horned_helm", name: "Smoczy hełm rogaty", aliases: ["dragon horned helm", "smoczy hełm", "rogaty hełm"], price: 1500, weight: 3.8, type: "head", slot: "head", icon: "/assets/items/dragon-horned-helm.png", defense: 7, statBonuses: { strength: 2, charisma: 1 }, classTags: ["warrior"], description: "Rogi są prawdziwe, a spojrzenie spod przyłbicy pamięta ogień." }
});

const ABILITY_KEYS = Object.freeze([
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma'
]);

const DEFAULT_PLAYER_STATS = Object.freeze({
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10
});

const EQUIPMENT_SLOTS = Object.freeze(['weapon', 'armor', 'head', 'gloves', 'legs', 'boots', 'offhand', 'accessory']);

function createFullMerchantInventory() {
    return [
        { id: 'bread', quantity: 10 },
        { id: 'healing_potion', quantity: 5 },
        { id: 'torch', quantity: 12 },
        ...Object.values(ITEM_CATALOG)
            .filter(item => item.slot)
            .map(item => ({ id: item.id, quantity: item.id === 'wooden_shield' ? 2 : 1 }))
    ];
}

function normalizeAbilityKey(value) {
    const key = String(value || '').trim().toLowerCase();
    return ABILITY_KEYS.includes(key) ? key : null;
}

function abilityModifier(score) {
    const safeScore = Number.isFinite(score) ? Math.floor(score) : 10;
    return Math.floor((safeScore - 10) / 2);
}

// Damage dice are intentionally kept small and validated on the server. The
// client never sends a dice expression, so a save or a narrator response
// cannot smuggle arbitrary work or damage into the combat resolver.
function normalizeDiceNotation(value, fallback = '1d4') {
    const match = String(value || '').trim().toLowerCase().match(/^(\d{1,2})d(\d{1,3})$/);
    if (!match) return fallback;
    const count = Math.max(1, Math.min(4, Number(match[1])));
    const sides = Math.max(2, Math.min(20, Number(match[2])));
    return `${count}d${sides}`;
}

function parseDiceNotation(value, fallback = '1d4') {
    const normalized = normalizeDiceNotation(value, fallback);
    const [count, sides] = normalized.split('d').map(Number);
    return { notation: normalized, count, sides };
}

function rollDice(value, fallback = '1d4') {
    const { notation, count, sides } = parseDiceNotation(value, fallback);
    const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    return { notation, rolls, total: rolls.reduce((sum, roll) => sum + roll, 0) };
}

// Scenario blueprints are authored content, not simulation state. Keep them
// deliberately bounded and JSON-safe before putting them in a world/save.
const SCENARIO_FIELDS = ['id', 'title', 'pitch', 'tone', 'activeAct', 'directorBrief', 'acts', 'mainArc', 'sideQuests', 'npcs', 'factions', 'choices', 'multiplayerHooks', 'endings', 'antiRailroadingRules'];

function scenarioSafeValue(value, depth = 0) {
    if (depth > 6 || value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return typeof value === 'string' ? value.slice(0, 4000) : value;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (Array.isArray(value)) {
        return value.slice(0, 200).map(item => scenarioSafeValue(item, depth + 1)).filter(item => item !== undefined);
    }
    if (typeof value === 'object') {
        const result = {};
        for (const key of Object.keys(value).slice(0, 200)) {
            const safe = scenarioSafeValue(value[key], depth + 1);
            if (safe !== undefined) result[String(key).slice(0, 120)] = safe;
        }
        return result;
    }
    return undefined;
}

function normalizeScenarioDefinition(rawScenario) {
    if (!rawScenario || typeof rawScenario !== 'object' || Array.isArray(rawScenario)) return null;
    const scenario = {};
    for (const field of SCENARIO_FIELDS) {
        const safe = scenarioSafeValue(rawScenario[field]);
        if (safe !== undefined) scenario[field] = safe;
    }
    return Object.keys(scenario).length ? scenario : null;
}

function newScenarioState(scenario) {
    const firstAct = scenario && Array.isArray(scenario.acts) && scenario.acts[0];
    return { activeAct: firstAct && typeof firstAct === 'object' ? (firstAct.id || null) : null, flags: [], choiceHistory: [], variables: {} };
}

// Phase 3: Goal types
const GOAL_TYPES = [
    "expand_territory",
    "destroy_faction",
    "economic_dominance",
    "survival",
    "religious_conversion",
    "alliance_formation",
    "cultural_dominance",
    "military_supremacy"
];

// Phase 3: Strategy names
const STRATEGY_NAMES = [
    "maintain_status_quo",
    "internal_stabilization",
    "expansion",
    "defensive",
    "economic_recovery",
    "covert_operations",
    "total_war",
    "diplomatic_coalition"
];

// Phase 4: Contextual Memory System constants
const MEMORY_CONFIG = {
    COMPRESSION_INTERVAL: 30,              // Actions before compression (20-40)
    MIN_COMPRESSION_INTERVAL: 20,
    MAX_COMPRESSION_INTERVAL: 40,
    MAX_LIVE_STATE_TOKENS: 1500,           // Max tokens for Live State
    MAX_HISTORY_TOKENS: 2500,              // Max tokens for history nodes
    MAX_CONTEXT_TOKENS: 4000,              // Total max context (Live State + History)
    MAX_NODES_PER_CONTEXT: 8,              // Max history nodes to include
    MIN_NODE_RELEVANCE: 0.15,              // Minimum relevance score to consider
    IMPORTANCE_THRESHOLD: 0.4,             // Threshold for "major events"
    MAX_WARS_IN_CONTEXT: 3,                // Max active wars in Live State
    MAX_REPUTATIONS_IN_CONTEXT: 5,         // Max reputations in Live State
    MAX_MAJOR_EVENTS_IN_CONTEXT: 5,        // Max recent major events
    NPC_MEMORY_DEPTH: 4                    // How many recent interactions to remember per NPC
};

// Scene types for context selection
const SCENE_TYPES = [
    "dialog",          // Conversation with NPC
    "combat",          // Battle/fighting
    "exploration",     // Exploring new area
    "trade",           // Buying/selling
    "rest",            // Resting/healing
    "travel",          // Moving between locations
    "default"          // Generic scene
];

// Scene tags for relevance scoring
const SCENE_TAGS = [
    "player_action",   // Player initiated
    "npc_interaction", // Involves NPC
    "combat",          // Combat related
    "political",       // Political intrigue
    "economic",        // Trade/money related
    "exploration",     // Discovery/travel
    "social",          // Social interaction
    "mystery",         // Mystery/clue
    "danger",          // Dangerous situation
    "peaceful",        // Calm/safe situation
    "major_event"      // World-changing event
];

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/**
 * Represents a single world change that occurred during an action
 */
class WorldChange {
    constructor(type, targetId, delta, description, scope) {
        this.type = type;                    // "reputation_changed", "npc_killed", etc.
        this.targetId = targetId;            // faction_id, npc_id, location_id
        this.delta = delta;                  // int, float, bool, str
        this.description = description;      // Human-readable version
        this.scope = scope;                  // "local" | "regional" | "global"
        this.staticImportance = this._calculateImportance();
    }

    _calculateImportance() {
        if (this.type === "reputation_changed" && typeof this.delta === "number") {
            return Math.abs(this.delta) >= 30 ? 0.40 : 0.15;
        }
        return IMPORTANCE_TABLE[this.type] || 0.1;
    }

    toJSON() {
        return {
            type: this.type,
            targetId: this.targetId,
            delta: this.delta,
            description: this.description,
            scope: this.scope,
            staticImportance: this.staticImportance
        };
    }

    static fromJSON(json) {
        return new WorldChange(
            json.type,
            json.targetId,
            json.delta,
            json.description,
            json.scope
        );
    }
}

/**
 * Result of any player action
 */
class ActionResult {
    constructor(success, message, timeCostMinutes, worldChanges = []) {
        this.success = success;
        this.message = message;
        this.timeCostMinutes = Number.isFinite(timeCostMinutes)
            ? Math.max(1, Math.floor(timeCostMinutes))
            : 1; // Minimum 1 minute
        this.worldChanges = worldChanges;
    }

    toJSON() {
        return {
            success: this.success,
            message: this.message,
            timeCostMinutes: this.timeCostMinutes,
            worldChanges: this.worldChanges.map(wc => wc.toJSON())
        };
    }

    static fromJSON(json) {
        const worldChanges = (json.worldChanges || []).map(wc => WorldChange.fromJSON(wc));
        return new ActionResult(
            json.success,
            json.message,
            json.timeCostMinutes,
            worldChanges
        );
    }
}

// ============================================================================
// PHASE 4: CONTEXTUAL MEMORY SYSTEM
// ============================================================================

/**
 * Phase 4: HistoryNode - compressed narrative memory unit
 * Used for LLM context summarization (Summaries layer)
 */
class HistoryNode {
    constructor() {
        this.nodeId = this._generateUUID();
        this.parentId = null;
        this.branchId = "main";                    // "main", "iron_war_1342", "player_betrayal"
        this.timeStartMinutes = 0;
        this.timeEndMinutes = 0;
        this.tags = new Set();                     // e.g., "player_action", "combat", "political"
        this.staticImportance = 0.0;
        this.dynamicImportance = 0.0;
        this.finalImportance = 0.0;
        this.persistent = false;
        this.relevanceScore = 1.0;
        this.lastReferencedTime = 0;
        this.causedBy = [];                        // nodeId[]
        this.causes = [];                          // nodeId[]
        this.summaryText = "";                     // 80–300 tokens (compressed)
        this.level = 1;                            // 1 = session/chapter, 2 = arc/month
    }

    _generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Calculate final importance score
     * Combines static importance with dynamic factors
     */
    calculateFinalImportance(currentTimeMinutes) {
        // Time decay factor: older events lose relevance
        const daysOld = (currentTimeMinutes - this.timeEndMinutes) / 1440;
        const timeDecay = Math.max(0.3, 1 - (daysOld * 0.02)); // Max 70% decay

        // Dynamic importance can increase if recently referenced
        const referenceBonus = this.lastReferencedTime > 0 
            ? Math.min(0.2, (currentTimeMinutes - this.lastReferencedTime) / 14400) // Max 0.2 for recent reference
            : 0;

        this.dynamicImportance = timeDecay + referenceBonus;
        this.finalImportance = (this.staticImportance * 0.6) + (this.dynamicImportance * 0.4);
        return this.finalImportance;
    }

    /**
     * Add a tag to this node
     */
    addTag(tag) {
        this.tags.add(tag);
    }

    /**
     * Check if node has any of the given tags
     */
    hasAnyTag(tagArray) {
        return tagArray.some(tag => this.tags.has(tag));
    }

    /**
     * Check if node has all given tags
     */
    hasAllTags(tagArray) {
        return tagArray.every(tag => this.tags.has(tag));
    }

    toJSON() {
        return {
            nodeId: this.nodeId,
            parentId: this.parentId,
            branchId: this.branchId,
            timeStartMinutes: this.timeStartMinutes,
            timeEndMinutes: this.timeEndMinutes,
            tags: Array.from(this.tags),
            staticImportance: this.staticImportance,
            dynamicImportance: this.dynamicImportance,
            finalImportance: this.finalImportance,
            persistent: this.persistent,
            relevanceScore: this.relevanceScore,
            lastReferencedTime: this.lastReferencedTime,
            causedBy: this.causedBy,
            causes: this.causes,
            summaryText: this.summaryText,
            level: this.level
        };
    }

    static fromJSON(json) {
        const node = new HistoryNode();
        node.nodeId = json.nodeId;
        node.parentId = json.parentId;
        node.branchId = json.branchId;
        node.timeStartMinutes = json.timeStartMinutes;
        node.timeEndMinutes = json.timeEndMinutes;
        node.tags = new Set(json.tags || []);
        node.staticImportance = json.staticImportance;
        node.dynamicImportance = json.dynamicImportance;
        node.finalImportance = json.finalImportance;
        node.persistent = json.persistent;
        node.relevanceScore = json.relevanceScore;
        node.lastReferencedTime = json.lastReferencedTime;
        node.causedBy = json.causedBy || [];
        node.causes = json.causes || [];
        node.summaryText = json.summaryText;
        node.level = json.level;
        return node;
    }
}

/**
 * Status effect applied to an entity
 */
class StatusEffect {
    constructor(name, durationMinutes, effectType, magnitude = 1.0) {
        this.name = name;
        this.remainingMinutes = durationMinutes;
        this.effectType = effectType;  // "hp_regen_modifier", "stamina_drain", etc.
        this.magnitude = magnitude;
    }

    tick(minutes) {
        this.remainingMinutes = Math.max(0, this.remainingMinutes - minutes);
        return this.remainingMinutes <= 0;
    }
}

/**
 * Phase 2: World Event - scheduled future event in the world
 */
class WorldEvent {
    constructor(
        eventId,
        type,
        executeAt,
        scope,
        data,
        priority = 100,
        hiddenFromPlayer = true,
        scheduledBy = null,
        importanceHint = 0.0
    ) {
        this.eventId = eventId;              // Unique identifier (UUID or timestamp + hash)
        this.type = type;                     // "war_battle", "economic_crisis", etc.
        this.executeAt = executeAt;           // current_time_minutes when event executes
        this.priority = priority;             // 1-1000, higher = earlier for same time
        this.scope = scope;                   // "local" | "regional" | "global"
        this.data = data;                     // Event-specific parameters
        this.hiddenFromPlayer = hiddenFromPlayer;
        this.scheduledBy = scheduledBy;       // faction_id | "player" | "system"
        this.importanceHint = importanceHint; // 0.0-1.0, used in Phase 5
    }

    toJSON() {
        return {
            eventId: this.eventId,
            type: this.type,
            executeAt: this.executeAt,
            priority: this.priority,
            scope: this.scope,
            data: this.data,
            hiddenFromPlayer: this.hiddenFromPlayer,
            scheduledBy: this.scheduledBy,
            importanceHint: this.importanceHint
        };
    }

    static fromJSON(json) {
        return new WorldEvent(
            json.eventId,
            json.type,
            json.executeAt,
            json.scope,
            json.data,
            json.priority,
            json.hiddenFromPlayer,
            json.scheduledBy,
            json.importanceHint
        );
    }
}

/**
 * Phase 2: MinHeap - priority queue for events
 */
class MinHeap {
    constructor() {
        this.heap = [];
    }

    push(item) {
        this.heap.push(item);
        this._bubbleUp(this.heap.length - 1);
    }

    pop() {
        if (this.heap.length === 0) return null;
        const result = this.heap[0];
        const last = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = last;
            this._bubbleDown(0);
        }
        return result;
    }

    peek() {
        return this.heap[0] || null;
    }

    get length() {
        return this.heap.length;
    }

    _bubbleUp(index) {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (this._compare(this.heap[index], this.heap[parentIndex]) >= 0) break;
            [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
            index = parentIndex;
        }
    }

    _bubbleDown(index) {
        while (true) {
            const leftChild = 2 * index + 1;
            const rightChild = 2 * index + 2;
            let smallest = index;

            if (leftChild < this.heap.length && 
                this._compare(this.heap[leftChild], this.heap[smallest]) < 0) {
                smallest = leftChild;
            }
            if (rightChild < this.heap.length && 
                this._compare(this.heap[rightChild], this.heap[smallest]) < 0) {
                smallest = rightChild;
            }
            if (smallest === index) break;
            [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
            index = smallest;
        }
    }

    _compare(a, b) {
        // Compare by executeAt first, then priority, then counter
        if (a[0] !== b[0]) return a[0] - b[0];
        if (a[1] !== b[1]) return a[1] - b[1];
        return a[2] - b[2];
    }
}

/**
 * Phase 2: EventQueue - manages scheduled world events
 */
class EventQueue {
    constructor() {
        this._heap = new MinHeap();
        this._counter = 0;
    }

    /**
     * Schedule an event
     * @param {WorldEvent} event 
     */
    schedule(event) {
        this._heap.push([
            event.executeAt,
            event.priority,
            this._counter,
            event
        ]);
        this._counter++;
    }

    /**
     * Peek at earliest event without removing
     * @returns {WorldEvent|null}
     */
    peek() {
        const entry = this._heap.peek();
        return entry ? entry[3] : null;
    }

    /**
     * Pop and return earliest event
     * @returns {WorldEvent}
     */
    popEarliest() {
        const entry = this._heap.pop();
        return entry ? entry[3] : null;
    }

    /**
     * Process all events up to target time
     * @param {World} world 
     * @param {number} targetTime 
     */
    processUpTo(world, targetTime) {
        while (this._heap.length > 0) {
            const entry = this._heap.peek();
            if (!entry || entry[0] > targetTime) break;
            
            const event = this.popEarliest();
            world.resolveEvent(event);
        }
    }

    /**
     * Get queue count
     * @returns {number}
     */
    count() {
        return this._heap.length;
    }

    /**
     * Count events by type
     * @param {string} eventType 
     * @returns {number}
     */
    countByType(eventType) {
        return this._heap.heap.reduce(
            (count, entry) => count + (entry[3]?.type === eventType ? 1 : 0),
            0
        );
    }

    /**
     * Count events scheduled by a faction
     * @param {string} factionId 
     * @returns {number}
     */
    countByFaction(factionId) {
        return this._heap.heap.reduce(
            (count, entry) => count + (entry[3]?.scheduledBy === factionId ? 1 : 0),
            0
        );
    }

    toJSON() {
        return {
            heap: this._heap.heap.map(entry => [
                entry[0],
                entry[1],
                entry[2],
                entry[3].toJSON()
            ]),
            counter: this._counter
        };
    }

    static fromJSON(json) {
        const queue = new EventQueue();
        queue._counter = Number.isSafeInteger(json?.counter) ? json.counter : 0;
        for (const entry of Array.isArray(json?.heap) ? json.heap : []) {
            queue._heap.heap.push([
                entry[0],
                entry[1],
                entry[2],
                WorldEvent.fromJSON(entry[3])
            ]);
        }
        return queue;
    }
}

// ============================================================================
// ENTITY CLASSES
// ============================================================================

/**
 * Location in the game world
 */
class Location {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.controllingFactionId = null;
        this.population = 0;
        this.wealth = 50;        // 0-100
        this.stability = 50;     // 0-100
        this.dangerLevel = 0;    // 0-100
        this.description = "";
        this.connections = [];
        
        // Optional: buildings, garrison, tradeRoutes (Phase 2+)
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            controllingFactionId: this.controllingFactionId,
            population: this.population,
            wealth: this.wealth,
            stability: this.stability,
            dangerLevel: this.dangerLevel,
            description: this.description,
            connections: this.connections
        };
    }

    static fromJSON(json) {
        const loc = new Location(json.id, json.name);
        loc.controllingFactionId = json.controllingFactionId;
        loc.population = json.population;
        loc.wealth = json.wealth;
        loc.stability = json.stability;
        loc.dangerLevel = json.dangerLevel;
        loc.description = json.description || "";
        loc.connections = Array.isArray(json.connections) ? json.connections : [];
        return loc;
    }
}

/**
 * Faction in the game world
 */
class Faction {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.power = 50;         // 0-100
        this.resources = 50;     // 0-100
        this.aggression = 50;    // 0-100
        this.stability = 50;     // 0-100
        this.relations = new Map(); // factionId -> -100...+100
        this.description = "";
        
        // Phase 3: Long-term goals and strategy
        this.longTermGoals = [];        // array of Goal (1-3 primary goals)
        this.currentStrategy = null;    // Strategy object or null
        this.strategicState = {};       // cache of current situation assessment
        this.lastStrategicUpdate = 0;   // current_time_minutes of last update
    }

    getRelation(factionId) {
        return this.relations.get(factionId) || 0;
    }

    setRelation(factionId, value) {
        this.relations.set(factionId, Math.max(-100, Math.min(100, value)));
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            power: this.power,
            resources: this.resources,
            aggression: this.aggression,
            stability: this.stability,
            relations: Object.fromEntries(this.relations),
            description: this.description,
            // Phase 3: Goals and strategy
            longTermGoals: this.longTermGoals.map(g => g.toJSON ? g.toJSON() : g),
            currentStrategy: this.currentStrategy ? this.currentStrategy.toJSON() : null,
            strategicState: this.strategicState,
            lastStrategicUpdate: this.lastStrategicUpdate
        };
    }

    static fromJSON(json) {
        const faction = new Faction(json.id, json.name);
        faction.power = json.power;
        faction.resources = json.resources;
        faction.aggression = json.aggression;
        faction.stability = json.stability;
        // FIX: Handle both Map (array of entries) and plain object
        if (Array.isArray(json.relations)) {
            faction.relations = new Map(json.relations);
        } else if (json.relations && typeof json.relations === 'object') {
            faction.relations = new Map(Object.entries(json.relations));
        } else {
            faction.relations = new Map();
        }
        faction.description = json.description || "";
        
        // Phase 3: Goals and strategy
        faction.longTermGoals = (json.longTermGoals || []).map(g => Goal.fromJSON ? Goal.fromJSON(g) : g);
        faction.currentStrategy = json.currentStrategy ? Strategy.fromJSON(json.currentStrategy) : null;
        faction.strategicState = json.strategicState || {};
        faction.lastStrategicUpdate = json.lastStrategicUpdate || 0;
        
        return faction;
    }

    /**
     * Phase 3: Check if faction is active (not destroyed)
     * @returns {boolean}
     */
    isActive() {
        return this.power > 10 && this.stability > 10;
    }
}

/**
 * Phase 3: Long-term goal for a faction
 */
class Goal {
    constructor(type, target = null, priority = 50) {
        this.type = type;                 // string: "expand_territory", "destroy_faction", etc.
        this.target = target;             // factionId, locationId or null
        this.priority = priority;         // 0-100 - higher = more important
        this.progress = 0.0;              // 0.0-1.0 - optional, if goal has measurable progress
    }

    toJSON() {
        return {
            type: this.type,
            target: this.target,
            priority: this.priority,
            progress: this.progress
        };
    }

    static fromJSON(json) {
        return new Goal(json.type, json.target, json.priority);
    }
}

/**
 * Phase 3: Current strategy for a faction
 */
class Strategy {
    constructor(name, score = 0.0) {
        this.name = name;                     // "expansion", "defensive", etc.
        this.score = score;                   // 0.0-1.0 - how well it fits current situation
        this.startTime = 0;                   // when strategy was chosen
        this.expectedDurationDays = 30;       // estimated duration
    }

    toJSON() {
        return {
            name: this.name,
            score: this.score,
            startTime: this.startTime,
            expectedDurationDays: this.expectedDurationDays
        };
    }

    static fromJSON(json) {
        const strategy = new Strategy(json.name, json.score);
        strategy.startTime = json.startTime || 0;
        strategy.expectedDurationDays = json.expectedDurationDays || 30;
        return strategy;
    }
}

/**
 * Non-Player Character
 */
class NPC {
    constructor(id, locationId, factionId = null) {
        this.id = id;
        this.locationId = locationId;
        this.factionId = factionId;
        
        // Player relationships (0-100)
        this.trust = 50;
        this.fear = 0;
        this.respect = 50;
        this.ambition = 50;
        this.loyalty = 50;
        
        // Additional fields
        this.name = "";
        this.description = "";
        this.role = "";
        this.statusEffects = [];
        
        // Combat stats (optional for Phase 1)
        this.hp = 50;
        this.maxHp = 50;
        this.attack = 5;
        this.defense = 0;
        this.armorClass = 10;
        this.damageDice = '1d6';
        this.goldReward = 0;
        this.xpReward = 10;
        this.isAlive = true;
        this.isMerchant = false;
        this.isQuestGiver = false;
        this.gold = 0;
        this.inventory = [];
        this.loot = [];
    }

    addStatusEffect(effect) {
        this.statusEffects.push(effect);
    }

    removeStatusEffect(effectName) {
        this.statusEffects = this.statusEffects.filter(e => e.name !== effectName);
    }

    toJSON() {
        return {
            id: this.id,
            locationId: this.locationId,
            factionId: this.factionId,
            trust: this.trust,
            fear: this.fear,
            respect: this.respect,
            ambition: this.ambition,
            loyalty: this.loyalty,
            name: this.name,
            description: this.description,
            role: this.role,
            statusEffects: this.statusEffects.map(e => ({
                name: e.name,
                remainingMinutes: e.remainingMinutes,
                effectType: e.effectType,
                magnitude: e.magnitude
            })),
            hp: this.hp,
            maxHp: this.maxHp,
            attack: this.attack,
            defense: this.defense,
            armorClass: this.armorClass,
            damageDice: this.damageDice,
            goldReward: this.goldReward,
            xpReward: this.xpReward,
            isAlive: this.isAlive,
            isMerchant: this.isMerchant,
            isQuestGiver: this.isQuestGiver,
            gold: this.gold,
            inventory: this.inventory,
            loot: this.loot
        };
    }

    static fromJSON(json) {
        const npc = new NPC(json.id, json.locationId, json.factionId);
        npc.trust = json.trust;
        npc.fear = json.fear;
        npc.respect = json.respect;
        npc.ambition = json.ambition;
        npc.loyalty = json.loyalty;
        npc.name = json.name || "";
        npc.description = json.description || "";
        npc.role = json.role || "";
        npc.statusEffects = (json.statusEffects || []).map(e => 
            new StatusEffect(e.name, e.remainingMinutes, e.effectType, e.magnitude)
        );
        npc.hp = Number.isFinite(json.hp) ? json.hp : npc.hp;
        npc.maxHp = Number.isFinite(json.maxHp) ? json.maxHp : npc.maxHp;
        npc.attack = Number.isFinite(json.attack) ? json.attack : npc.attack;
        npc.defense = Number.isFinite(json.defense) ? json.defense : npc.defense;
        npc.armorClass = Number.isFinite(json.armorClass)
            ? Math.max(1, Math.min(40, Math.floor(json.armorClass)))
            : Math.max(1, Math.min(40, 10 + Math.floor(npc.defense)));
        npc.damageDice = normalizeDiceNotation(json.damageDice, npc.damageDice);
        npc.goldReward = Number.isFinite(json.goldReward) ? json.goldReward : npc.goldReward;
        npc.xpReward = Number.isFinite(json.xpReward) ? json.xpReward : npc.xpReward;
        npc.isAlive = json.isAlive !== false;
        npc.isMerchant = json.isMerchant === true;
        npc.isQuestGiver = json.isQuestGiver === true;
        npc.gold = Number.isFinite(json.gold) ? Math.max(0, Math.floor(json.gold)) : (npc.isMerchant ? 500 : 0);
        npc.inventory = Array.isArray(json.inventory)
            ? json.inventory
                .filter(item => item && ITEM_CATALOG[item.id] && Number.isInteger(item.quantity) && item.quantity > 0)
                .map(item => ({ id: item.id, quantity: Math.min(1000, item.quantity) }))
            : [];
        npc.loot = Array.isArray(json.loot)
            ? json.loot
                .filter(item => item && ITEM_CATALOG[item.id] && Number.isInteger(item.quantity) && item.quantity > 0)
                .map(item => ({ id: item.id, quantity: Math.min(1000, item.quantity) }))
            : [];
        return npc;
    }
}

/**
 * Player character
 */
class Player {
    constructor(name, locationId) {
        this.name = name;
        this.locationId = locationId;
        
        // Resources
        this.gold = 100;
        this.hp = 100;
        this.maxHp = 100;
        this.isDowned = false;
        this.stamina = 100;
        this.maxStamina = 100;
        this.mana = 50;
        this.maxMana = 50;
        
        // Survival stats (0-100, higher = more depleted)
        this.hunger = 0;
        this.thirst = 0;
        this.fatigue = 0;
        
        // Faction reputation (factionId -> -100...+100)
        this.reputation = new Map();
        
        // Status effects
        this.statusEffects = [];
        
        // Story flags (strings like "killed_lord_v", "joined_cult_x")
        this.storyFlags = new Set();

        // NPC names are personal knowledge. In multiplayer one character may
        // learn a name before another character does.
        this.knownNpcIds = new Set();
        
        // Inventory (Phase 2+)
        this.inventory = [];
        this.equipment = {
            weapon: null,
            armor: null,
            head: null,
            gloves: null,
            legs: null,
            boots: null,
            offhand: null,
            accessory: null
        };

        // Minimal D&D-like progression used by deterministic actions.
        this.level = 1;
        this.xp = 0;
        this.attack = 8;
        this.defense = 0;
        this.stats = { ...DEFAULT_PLAYER_STATS };
        this.unspentStatPoints = 27;
        this.skillPoints = 0;
        this.proficiencyBonus = 2;
        this.quests = [];
    }

    getAbilityScore(ability) {
        const key = normalizeAbilityKey(ability);
        return key ? Math.max(1, Math.min(30, Math.floor(Number(this.stats?.[key]) || 10))) : 10;
    }

    getAbilityModifier(ability) {
        return abilityModifier(this.getAbilityScore(ability) + this.getEquipmentStatBonus(normalizeAbilityKey(ability)));
    }

    getStatSummary() {
        return ABILITY_KEYS.reduce((summary, key) => {
            summary[key] = {
                score: this.getAbilityScore(key),
                modifier: this.getAbilityModifier(key)
            };
            return summary;
        }, {});
    }

    spendStatPoint(ability) {
        const key = normalizeAbilityKey(ability);
        if (!key || this.unspentStatPoints <= 0 || this.getAbilityScore(key) >= 20) return false;
        this.stats[key] = this.getAbilityScore(key) + 1;
        this.unspentStatPoints -= 1;
        if (key === 'constitution') {
            this.maxHp += 2;
            this.hp = Math.min(this.maxHp, this.hp + 2);
        }
        return true;
    }

    getItem(itemId) {
        return this.inventory.find(item => item.id === itemId) || null;
    }

    addItem(itemId, quantity = 1) {
        const amount = Number.isInteger(quantity) ? quantity : 0;
        if (amount <= 0 || !ITEM_CATALOG[itemId]) return false;
        const existing = this.getItem(itemId);
        if (existing) existing.quantity += amount;
        else this.inventory.push({ id: itemId, quantity: amount });
        return true;
    }

    removeItem(itemId, quantity = 1) {
        const amount = Number.isInteger(quantity) ? quantity : 0;
        const existing = this.getItem(itemId);
        if (amount <= 0 || !existing || existing.quantity < amount) return false;
        existing.quantity -= amount;
        if (existing.quantity <= 0) {
            this.inventory = this.inventory.filter(item => item.id !== itemId);
        }
        return true;
    }

    getItemQuantity(itemId) {
        return this.getItem(itemId)?.quantity || 0;
    }

    getInventoryWeight() {
        return this.inventory.reduce((total, entry) => {
            const item = ITEM_CATALOG[entry.id];
            return total + (item ? (Number(item.weight) || 0) * Math.max(0, Number(entry.quantity) || 0) : 0);
        }, 0);
    }

    getCarryCapacity() {
        return 20 + (this.getAbilityScore('strength') * 2);
    }

    canCarry(itemId, quantity = 1) {
        const item = ITEM_CATALOG[itemId];
        const amount = Number.isInteger(quantity) ? quantity : 0;
        if (!item || amount <= 0) return false;
        return this.getInventoryWeight() + ((Number(item.weight) || 0) * amount) <= this.getCarryCapacity();
    }

    getEquippedItemIds() {
        return EQUIPMENT_SLOTS
            .map(slot => this.equipment?.[slot])
            .filter(itemId => typeof itemId === 'string' && itemId);
    }

    getEquippedItems() {
        return this.getEquippedItemIds()
            .map(itemId => ITEM_CATALOG[itemId])
            .filter(Boolean);
    }

    isItemEquipped(itemId) {
        return this.getEquippedItemIds().includes(itemId);
    }

    equipItem(itemId) {
        const item = ITEM_CATALOG[itemId];
        if (!item?.slot || !EQUIPMENT_SLOTS.includes(item.slot) || this.getItemQuantity(itemId) < 1) return false;
        this.equipment[item.slot] = itemId;
        return true;
    }

    unequipItem(slotOrItemId) {
        const value = String(slotOrItemId || '').trim();
        const slot = EQUIPMENT_SLOTS.includes(value)
            ? value
            : EQUIPMENT_SLOTS.find(key => this.equipment?.[key] === value);
        if (!slot || !this.equipment?.[slot]) return false;
        this.equipment[slot] = null;
        return true;
    }

    getEquipmentStatBonus(ability) {
        return this.getEquippedItems().reduce((total, item) => total + (Number(item.statBonuses?.[ability]) || 0), 0);
    }

    getAttackPower() {
        const equipmentBonus = this.getEquippedItems()
            .reduce((total, item) => total + (item.attack || 0), 0);
        return Math.max(1, this.attack + this.getAbilityModifier('strength') + equipmentBonus);
    }

    getArmorClass() {
        return Math.max(1, 10 + this.getDefensePower());
    }

    getDamageProfile() {
        const weapon = this.equipment?.weapon ? ITEM_CATALOG[this.equipment.weapon] : null;
        const weaponBonus = Number(weapon?.attack) || 0;
        const baseBonus = Math.max(0, this.attack - 8);
        return {
            dice: normalizeDiceNotation(weapon?.damageDice, '1d4'),
            bonus: this.getAbilityModifier('strength') + baseBonus + weaponBonus,
            weaponId: weapon?.id || null,
            weaponName: weapon?.name || 'pięść'
        };
    }

    getDefensePower() {
        const equipmentBonus = this.getEquippedItems()
            .reduce((total, item) => total + (item.defense || 0), 0);
        return Math.max(0, this.defense + this.getAbilityModifier('dexterity') + equipmentBonus);
    }

    addQuest(quest) {
        if (!quest?.id || this.quests.some(existing => existing.id === quest.id)) return false;
        this.quests.push({ ...quest });
        return true;
    }

    getQuest(questId) {
        return this.quests.find(quest => quest.id === questId) || null;
    }

    gainXp(amount) {
        const safeAmount = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
        this.xp += safeAmount;
        let levelsGained = 0;
        while (this.xp >= this.level * 100) {
            this.xp -= this.level * 100;
            this.level += 1;
            this.maxHp += 10;
            this.hp = this.maxHp;
            this.attack += 2;
            this.unspentStatPoints += 2;
            this.skillPoints += 1;
            this.proficiencyBonus = 2 + Math.floor((this.level - 1) / 4);
            levelsGained += 1;
        }
        return levelsGained;
    }

    addStatusEffect(effect) {
        this.statusEffects.push(effect);
    }

    removeStatusEffect(effectName) {
        this.statusEffects = this.statusEffects.filter(e => e.name !== effectName);
    }

    hasFlag(flag) {
        return this.storyFlags.has(flag);
    }

    addFlag(flag) {
        this.storyFlags.add(flag);
    }

    knowsNpcName(npcId) {
        return typeof npcId === 'string' && this.knownNpcIds.has(npcId);
    }

    revealNpcName(npcId) {
        if (typeof npcId !== 'string' || !npcId.trim()) return false;
        const before = this.knownNpcIds.has(npcId);
        this.knownNpcIds.add(npcId);
        return !before;
    }

    getReputation(factionId) {
        return this.reputation.get(factionId) || 0;
    }

    setReputation(factionId, value) {
        this.reputation.set(factionId, Math.max(-100, Math.min(100, value)));
    }

    changeReputation(factionId, delta) {
        const current = this.getReputation(factionId);
        this.setReputation(factionId, current + delta);
    }

    toJSON() {
        return {
            name: this.name,
            locationId: this.locationId,
            gold: this.gold,
            hp: this.hp,
            maxHp: this.maxHp,
            isDowned: this.isDowned,
            stamina: this.stamina,
            maxStamina: this.maxStamina,
            mana: this.mana,
            maxMana: this.maxMana,
            hunger: this.hunger,
            thirst: this.thirst,
            fatigue: this.fatigue,
            level: this.level,
            xp: this.xp,
            attack: this.attack,
            defense: this.defense,
            stats: { ...this.stats },
            unspentStatPoints: this.unspentStatPoints,
            skillPoints: this.skillPoints,
            proficiencyBonus: this.proficiencyBonus,
            equipment: { ...this.equipment },
            reputation: Object.fromEntries(this.reputation),
            statusEffects: this.statusEffects.map(e => ({
                name: e.name,
                remainingMinutes: e.remainingMinutes,
                effectType: e.effectType,
                magnitude: e.magnitude
            })),
            storyFlags: Array.from(this.storyFlags),
            knownNpcIds: Array.from(this.knownNpcIds),
            inventory: this.inventory,
            quests: this.quests
        };
    }

    static fromJSON(json) {
        const player = new Player(json.name || 'Player', json.locationId || 'town_central');
        player.gold = Number.isFinite(json.gold) ? json.gold : player.gold;
        player.hp = Number.isFinite(json.hp) ? json.hp : player.hp;
        player.maxHp = Number.isFinite(json.maxHp) ? json.maxHp : player.maxHp;
        player.isDowned = json.isDowned === true || player.hp <= 0;
        player.stamina = Number.isFinite(json.stamina) ? json.stamina : player.stamina;
        player.maxStamina = Number.isFinite(json.maxStamina) ? json.maxStamina : player.maxStamina;
        player.mana = Number.isFinite(json.mana) ? json.mana : player.mana;
        player.maxMana = Number.isFinite(json.maxMana) ? json.maxMana : player.maxMana;
        player.hunger = Number.isFinite(json.hunger) ? json.hunger : player.hunger;
        player.thirst = Number.isFinite(json.thirst) ? json.thirst : player.thirst;
        player.fatigue = Number.isFinite(json.fatigue) ? json.fatigue : player.fatigue;
        player.level = Number.isFinite(json.level) ? Math.max(1, Math.floor(json.level)) : player.level;
        player.xp = Number.isFinite(json.xp) ? Math.max(0, Math.floor(json.xp)) : player.xp;
        player.attack = Number.isFinite(json.attack) ? json.attack : player.attack;
        player.defense = Number.isFinite(json.defense) ? json.defense : player.defense;
        if (json.stats && typeof json.stats === 'object') {
            for (const key of ABILITY_KEYS) {
                if (Number.isFinite(json.stats[key])) player.stats[key] = Math.max(1, Math.min(30, Math.floor(json.stats[key])));
            }
        }
        player.unspentStatPoints = Number.isFinite(json.unspentStatPoints)
            ? Math.max(0, Math.floor(json.unspentStatPoints))
            : player.unspentStatPoints;
        player.skillPoints = Number.isFinite(json.skillPoints)
            ? Math.max(0, Math.floor(json.skillPoints))
            : player.skillPoints;
        player.proficiencyBonus = Number.isFinite(json.proficiencyBonus)
            ? Math.max(2, Math.floor(json.proficiencyBonus))
            : 2 + Math.floor((player.level - 1) / 4);
        // FIX: Handle both Map (array of entries) and plain object
        if (Array.isArray(json.reputation)) {
            player.reputation = new Map(json.reputation);
        } else if (json.reputation && typeof json.reputation === 'object') {
            player.reputation = new Map(Object.entries(json.reputation));
        } else {
            player.reputation = new Map();
        }
        player.statusEffects = (json.statusEffects || []).map(e => 
            new StatusEffect(e.name, e.remainingMinutes, e.effectType, e.magnitude)
        );
        player.storyFlags = new Set(json.storyFlags || []);
        player.knownNpcIds = new Set(Array.isArray(json.knownNpcIds)
            ? json.knownNpcIds.filter(id => typeof id === 'string' && id.trim())
            : []);
        player.inventory = Array.isArray(json.inventory)
            ? json.inventory
                .filter(item => item && ITEM_CATALOG[item.id] && Number.isInteger(item.quantity) && item.quantity > 0)
                .map(item => ({ id: item.id, quantity: item.quantity }))
            : [];
        if (json.equipment && typeof json.equipment === 'object') {
            for (const slot of EQUIPMENT_SLOTS) {
                const itemId = json.equipment[slot];
                if (typeof itemId === 'string' && ITEM_CATALOG[itemId]?.slot === slot && player.getItemQuantity(itemId) > 0) {
                    player.equipment[slot] = itemId;
                }
            }
        }
        player.quests = Array.isArray(json.quests) ? json.quests : [];
        return player;
    }
}

// ============================================================================
// WORLD CLASS - MAIN ENGINE
// ============================================================================

/**
 * Main world engine - contains all game state and simulation logic
 */
class World {
    constructor() {
        // Global simulation clock - minutes from arbitrary epoch
        this.currentTimeMinutes = 0;
        
        // Entity storage
        this.locations = new Map();   // locationId -> Location
        this.factions = new Map();    // factionId -> Faction
        this.npcs = new Map();        // npcId -> NPC
        this.player = null;
        
        // Phase 2: Event queue
        this.eventQueue = new EventQueue();
        
        // Phase 2: Track active wars
        this.activeWars = new Map();  // attackerId -> Set of defenderIds
        
        // World log - all changes that occurred
        this.worldLog = [];
        
        // Phase 3: Strategic tracking
        this.lastGlobalStrategicUpdate = 0;  // last strategic update timestamp
        
        // Phase 4: Contextual Memory System
        this.historyNodes = [];              // HistoryNode[] (Summaries layer)
        this.rawChangeLog = [];              // WorldChange[] (Raw Archive layer)
        this.actionCountSinceLastCompression = 0;
        this.currentNpcMemory = new Map();   // npcId -> recent interactions
        // NarrativeMemory V1 is a separate, structured story layer. It never
        // authoritatively changes the simulation fields above.
        this.narrativeMemory = new NarrativeMemory();
        this.questDefinitions = [];
        // Combat is a separate mechanical subsystem. It is serialized with
        // the world, but it never creates a narrator turn by itself.
        this.combatState = null;
        
        // Configuration
        this.config = {
            regenRates: { ...DEFAULT_REGEN },
            consumptionRates: { ...DEFAULT_CONSUMPTION },
            statusThresholds: { ...STATUS_THRESHOLDS },
            eventLimits: { ...EVENT_LIMITS }
        };
        
        // RNG seed (optional)
        this.seed = null;

        // Generated world brief. Keeping it in the engine makes saves and multiplayer snapshots self-contained.
        this.worldMetadata = {
            name: null,
            description: null,
            plan: null,
            scenario: null
        };
        this.scenario = null;
        this.scenarioState = newScenarioState(null);
        this.isSandbox = false;
    }

    // ========================================================================
    // TIME MANAGEMENT
    // ========================================================================

    /**
     * Advance world time - THE ONLY LEGAL METHOD to change time
     * @param {number} minutes - Minutes to advance (must be >= 0)
     * @throws {Error} If minutes is negative
     */
    advanceWorldTime(minutes) {
        if (!Number.isInteger(minutes) || minutes < 0 || !Number.isSafeInteger(minutes)) {
            throw new Error("Time advance must be a non-negative safe integer");
        }
        
        this.currentTimeMinutes += minutes;
        
        // Process time-dependent systems
        this.updateTimeDependentSystems(minutes);
        
        // Phase 2: Process events that should have executed
        if (this.eventQueue) {
            this.eventQueue.processUpTo(this, this.currentTimeMinutes);
        }
        
        // Phase 2: Strategic updates (every 7 days)
        this.strategicUpdate();
    }

    /**
     * Advance global time while applying player-specific survival effects.
     * Multiplayer rooms use this method so every connected player can keep
     * an independent character sheet inside one shared world clock.
     */
    advanceWorldTimeForPlayer(player, minutes, options = {}) {
        if (!player) throw new Error("A player is required");
        if (!Number.isInteger(minutes) || minutes < 0 || !Number.isSafeInteger(minutes)) {
            throw new Error("Time advance must be a non-negative safe integer");
        }

        this.currentTimeMinutes += minutes;
        this.updatePlayerTimeDependentSystems(player, minutes, options);

        for (const npc of this.npcs.values()) {
            this._updateStatusEffects(npc, minutes);
        }
        this._updateEconomicState(minutes);
        if (this.eventQueue) {
            this.eventQueue.processUpTo(this, this.currentTimeMinutes);
        }
        this.strategicUpdate();
    }

    /**
     * Update all systems that depend on time passage
     * Called after every time advancement
     * @param {number} minutes - Minutes that passed
     */
    updateTimeDependentSystems(minutes) {
        if (!this.player) return;

        this.updatePlayerTimeDependentSystems(this.player, minutes);

        // NPC effects and global systems are updated once per world advance.
        for (const npc of this.npcs.values()) {
            this._updateStatusEffects(npc, minutes);
        }
        this._updateEconomicState(minutes);
    }

    /** Update resources and survival state for one player. */
    updatePlayerTimeDependentSystems(player, minutes, options = {}) {
        if (!player) return;
        const cfg = this.config;

        // 1. Regeneration of HP/Stamina/Mana
        // HP does not passively regenerate during an active combat round.
        // Healing in combat must come from an item, spell or explicit effect.
        const hpRegenRate = options.suppressHpRegen === true ? 0 : cfg.regenRates.hp;
        this._updateResource(player, 'hp', hpRegenRate, minutes, player.maxHp);
        this._updateResource(player, 'stamina', cfg.regenRates.stamina, minutes, player.maxStamina);
        this._updateResource(player, 'mana', cfg.regenRates.mana, minutes, player.maxMana);
        
        // 2. Survival stats consumption
        this._updateSurvivalStats(player, minutes);
        
        // 3. Update status effects duration
        this._updateStatusEffects(player, minutes);

        // 4. Weather change (optional - if implemented)
        // this._updateWeather(minutes);

        // 5. NPC aging (optional - if age matters)
        // this._updateNPCAges(minutes);
    }

    /**
     * Update a single resource (HP/Stamina/Mana)
     */
    _updateResource(entity, resourceName, ratePerMinute, minutes, maxValue) {
        const current = entity[resourceName];
        const newValue = Math.min(maxValue, current + (ratePerMinute * minutes));
        entity[resourceName] = newValue;
        
        // Check for status effect modifications
        const statusMod = this._getStatusEffectModifier(entity, `${resourceName}_regen_modifier`);
        if (statusMod !== 1.0) {
            const modifiedValue = Math.min(maxValue, current + (ratePerMinute * minutes * statusMod));
            entity[resourceName] = modifiedValue;
        }
    }

    /**
     * Update hunger, thirst, fatigue
     */
    _updateSurvivalStats(player, minutes) {
        const cfg = this.config;
        
        // Hunger
        player.hunger = Math.min(100, player.hunger + (cfg.consumptionRates.hunger * minutes));
        
        // Thirst
        player.thirst = Math.min(100, player.thirst + (cfg.consumptionRates.thirst * minutes));
        
        // Fatigue
        player.fatigue = Math.min(100, player.fatigue + (cfg.consumptionRates.fatigue * minutes));
        
        // Check thresholds and apply status effects
        this._checkSurvivalThresholds(player);
    }

    /**
     * Check survival thresholds and apply/remove status effects
     */
    _checkSurvivalThresholds(player) {
        const thresholds = this.config.statusThresholds;
        
        // Starving
        if (player.hunger >= thresholds.starving) {
            if (!player.statusEffects.find(e => e.name === 'starving')) {
                player.addStatusEffect(new StatusEffect('starving', 60, 'hp_drain', 0.5));
            }
        } else {
            player.removeStatusEffect('starving');
        }
        
        // Dehydrated
        if (player.thirst >= thresholds.dehydrated) {
            if (!player.statusEffects.find(e => e.name === 'dehydrated')) {
                player.addStatusEffect(new StatusEffect('dehydrated', 60, 'stamina_drain', 0.5));
            }
        } else {
            player.removeStatusEffect('dehydrated');
        }
        
        // Exhausted
        if (player.fatigue >= thresholds.exhausted) {
            if (!player.statusEffects.find(e => e.name === 'exhausted')) {
                player.addStatusEffect(new StatusEffect('exhausted', 60, 'all_stats_drain', 0.7));
            }
        } else {
            player.removeStatusEffect('exhausted');
        }
    }

    /**
     * Update status effects - decrease duration and remove expired
     */
    _updateStatusEffects(entity, minutes) {
        const expired = [];

        for (const effect of entity.statusEffects) {
            const activeMinutes = Math.min(minutes, Math.max(0, effect.remainingMinutes));
            const isExpired = effect.tick(minutes);
            if (isExpired) {
                expired.push(effect.name);
            }

            // Apply continuous effects for the time during which the effect
            // was actually active. Previously this ran once per action,
            // making a 60-minute effect almost harmless on long actions.
            if (activeMinutes > 0) {
                this._applyStatusEffect(entity, effect, activeMinutes);
            }
        }
        
        // Remove expired effects
        for (const name of expired) {
            entity.removeStatusEffect(name);
        }
    }

    /**
     * Apply a status effect's continuous modifiers
     */
    _applyStatusEffect(entity, effect, minutes = 1) {
        switch (effect.effectType) {
            case 'hp_drain':
                entity.hp = Math.max(0, entity.hp - (effect.magnitude * 0.1 * minutes));
                break;
            case 'stamina_drain':
                entity.stamina = Math.max(0, entity.stamina - (effect.magnitude * 0.1 * minutes));
                break;
            case 'all_stats_drain':
                entity.hp = Math.max(0, entity.hp - (effect.magnitude * 0.05 * minutes));
                entity.stamina = Math.max(0, entity.stamina - (effect.magnitude * 0.05 * minutes));
                break;
            // Add more effect types as needed
        }
    }

    /**
     * Get status effect modifier for a resource
     */
    _getStatusEffectModifier(entity, effectType) {
        for (const effect of entity.statusEffects) {
            if (effect.effectType === effectType) {
                return effect.magnitude;
            }
        }
        return 1.0;
    }

    /**
     * Update economic state (very slow natural changes)
     */
    _updateEconomicState(minutes) {
        // Very small multiplier - only matters over long play sessions
        const multiplier = minutes / (24 * 60); // Per in-game day
        
        for (const location of this.locations.values()) {
            // Small random wealth fluctuation
            location.wealth = Math.max(0, Math.min(100, 
                location.wealth + (Math.random() - 0.5) * 2 * multiplier
            ));
            
            // Small stability fluctuation
            location.stability = Math.max(0, Math.min(100,
                location.stability + (Math.random() - 0.5) * 1 * multiplier
            ));
        }
    }

    // ========================================================================
    // PLAYER ACTIONS - DETERMINISTIC MECHANICS
    // ========================================================================

    _resolveItemInAction(normalizedAction) {
        const items = Object.values(ITEM_CATALOG).sort((a, b) => b.name.length - a.name.length);
        const actionText = String(normalizedAction || '').toLocaleLowerCase('pl-PL');
        const spacedActionText = actionText.replace(/[_-]+/g, ' ');
        return items.find(item => {
            const candidates = [item.id, item.name, ...(Array.isArray(item.aliases) ? item.aliases : [])]
                .map(value => String(value || '').toLocaleLowerCase('pl-PL').trim())
                .filter(Boolean);
            return candidates.some(candidate => {
                const spacedCandidate = candidate.replace(/[_-]+/g, ' ');
                return actionText.includes(candidate) || spacedActionText.includes(spacedCandidate);
            });
        }) || null;
    }

    _findNpcInAction(normalizedAction, player, allowSingleFallback = false) {
        const available = Array.from(this.npcs.values()).filter(npc =>
            npc.locationId === player.locationId && npc.isAlive !== false
        );
        const named = available.find(npc => {
            const id = String(npc.id || '').toLocaleLowerCase('pl-PL');
            const name = String(npc.name || '').toLocaleLowerCase('pl-PL');
            return (id && normalizedAction.includes(id)) || (name && normalizedAction.includes(name));
        });
        if (named) return named;
        return allowSingleFallback && available.length === 1 ? available[0] : null;
    }

    _findMerchant(player) {
        return Array.from(this.npcs.values()).find(npc =>
            npc.locationId === player.locationId && npc.isAlive !== false && npc.isMerchant
        ) || null;
    }

    _ensureSandboxNpcFromAction(normalizedAction, player, changes = []) {
        if (!this.isSandbox || !player || !/(handlarz|kupiec|sprzedawca|sklepikarz|merchant|trader|towar\w*)/i.test(normalizedAction)) return null;
        const existing = this._findMerchant(player);
        if (existing) return existing;

        let id = `sandbox_merchant_${player.locationId}`;
        let suffix = 2;
        while (this.npcs.has(id)) id = `sandbox_merchant_${player.locationId}_${suffix++}`;
        const merchant = new NPC(id, player.locationId, null);
        merchant.name = 'Nieznany handlarz';
        merchant.role = 'handlarz';
        merchant.description = 'Wędrowny handlarz, który pojawił się tu dzięki działaniom drużyny.';
        merchant.isMerchant = true;
        merchant.gold = 500;
        merchant.inventory = createFullMerchantInventory();
        this.addNPC(merchant);
        changes.push(new WorldChange('npc_discovered', merchant.id, true, 'W lokacji pojawia się handlarz.', 'local'));
        return merchant;
    }

    _findQuestGiver(player) {
        return Array.from(this.npcs.values()).find(npc =>
            npc.locationId === player.locationId && npc.isAlive !== false && npc.isQuestGiver
        ) || null;
    }

    _getStarterQuest() {
        if (this.questDefinitions.length > 0) {
            const blueprintQuest = this.questDefinitions[0];
            return {
                ...blueprintQuest,
                status: 'active',
                objective: { ...(blueprintQuest.objective || {}), progress: 0 },
                reward: { ...(blueprintQuest.reward || {}) }
            };
        }
        return {
            id: 'forest_threat',
            title: 'Zagrozenie w lesie',
            description: 'Pokonaj bandyte grasujacego przy wejsciu do lasu.',
            status: 'active',
            objective: { type: 'kill_npc', targetId: 'npc_forest_bandit', required: 1, progress: 0 },
            reward: { gold: 50, xp: 40 }
        };
    }

    _questIsAvailableToGiver(quest, questGiver, player) {
        if (!quest || quest.status === 'completed' || quest.status === 'active') return false;
        if (quest.giverId && quest.giverId !== questGiver.id) return false;
        if (quest.giverLocationId && quest.giverLocationId !== player.locationId) return false;
        return true;
    }

    _completeQuest(player, quest, changes) {
        if (!quest || quest.status === 'completed') return false;
        quest.objective = { ...(quest.objective || {}), progress: 1 };
        quest.status = 'completed';
        const gold = Number.isFinite(quest.reward?.gold) ? quest.reward.gold : 0;
        const xp = Number.isFinite(quest.reward?.xp) ? quest.reward.xp : 0;
        player.gold += gold;
        player.gainXp(xp);
        changes.push(new WorldChange('quest_completed', quest.id, true, quest.title, 'local'));
        if (gold) changes.push(new WorldChange('gold_changed', player.name, gold, 'Quest reward', 'local'));
        if (xp) changes.push(new WorldChange('xp_gained', player.name, xp, 'Quest reward experience', 'local'));
        return true;
    }

    _completeExploreQuests(player, locationId, changes) {
        for (const quest of player.quests) {
            const objective = quest.objective;
            if (quest.status !== 'active' || objective?.type !== 'explore' || objective.targetId !== locationId) continue;
            this._completeQuest(player, quest, changes);
        }
    }

    _tryUseItem(normalizedAction, player) {
        if (!/(use|uzyj|użyj|zjedz|zjedź)/i.test(normalizedAction)) return null;
        const item = this._resolveItemInAction(normalizedAction);
        if (!item) return { success: false, message: 'Nie rozpoznaje przedmiotu do uzycia.', timeCostMinutes: 1, changes: [] };
        if (player.getItemQuantity(item.id) < 1) {
            return { success: false, message: `Nie masz przedmiotu: ${item.name}.`, timeCostMinutes: 1, changes: [] };
        }
        player.removeItem(item.id, 1);
        const changes = [new WorldChange('item_used', item.id, -1, `Used ${item.name}`, 'local')];
        if (item.heal) {
            const before = player.hp;
            player.hp = Math.min(player.maxHp, player.hp + item.heal);
            if (player.hp > 0) player.isDowned = false;
            changes.push(new WorldChange('player_healed', player.name, player.hp - before, `Healed ${player.hp - before} HP`, 'local'));
        }
        if (item.hungerRestore) {
            player.hunger = Math.max(0, player.hunger - item.hungerRestore);
            changes.push(new WorldChange('survival_stat_changed', player.name, -item.hungerRestore, 'Food restored hunger', 'local'));
        }
        return { success: true, message: `Uzywasz: ${item.name}.`, timeCostMinutes: 1, changes };
    }

    _tryTradeAction(normalizedAction, player) {
        const merchant = this._findMerchant(player);
        if (!merchant) return { success: false, message: 'W tej lokacji nie ma kupca.', timeCostMinutes: 1, changes: [] };
        const item = this._resolveItemInAction(normalizedAction);
        if (!item) return { success: false, message: 'Podaj przedmiot, ktory chcesz kupic albo sprzedac.', timeCostMinutes: 1, changes: [] };
        const changes = [];
        const isSell = /(sell|sprzed|oddaj)/i.test(normalizedAction);
        const stock = merchant.inventory.find(entry => entry.id === item.id);
        const buyPrice = Math.max(1, Math.floor(item.price));
        const sellPrice = Math.max(1, Math.floor(item.price * 0.5));
        if (!Number.isFinite(merchant.gold)) merchant.gold = 500;
        if (isSell) {
            if (player.getItemQuantity(item.id) < 1) {
                return { success: false, message: `Nie masz przedmiotu: ${item.name}.`, timeCostMinutes: 1, changes: [] };
            }
            if (player.isItemEquipped(item.id)) {
                return { success: false, message: `Najpierw zdejmij ${item.name}, aby go sprzedać.`, timeCostMinutes: 1, changes: [] };
            }
            if (merchant.gold < sellPrice) {
                return { success: false, message: `Kupiec nie ma dość złota, aby zapłacić za ${item.name}.`, timeCostMinutes: 1, changes: [] };
            }
            player.removeItem(item.id, 1);
            player.gold += sellPrice;
            merchant.gold -= sellPrice;
            if (stock) stock.quantity += 1;
            else merchant.inventory.push({ id: item.id, quantity: 1 });
            changes.push(new WorldChange('item_sold', item.id, -1, `Sprzedano ${item.name}.`, 'local'));
            changes.push(new WorldChange('gold_changed', player.name, sellPrice, `Otrzymano ${sellPrice} złota.`, 'local'));
            return { success: true, message: `Sprzedajesz ${item.name} za ${sellPrice} złota.`, timeCostMinutes: 5, changes };
        }
        if (!stock || stock.quantity < 1) {
            return { success: false, message: `Kupiec nie ma przedmiotu: ${item.name}.`, timeCostMinutes: 1, changes: [] };
        }
        if (player.gold < buyPrice) {
            return { success: false, message: `Brakuje ci złota. Cena to ${buyPrice}.`, timeCostMinutes: 1, changes: [] };
        }
        if (!player.canCarry(item.id, 1)) {
            return { success: false, message: `Nie masz miejsca na ${item.name}. Waga: ${player.getInventoryWeight().toFixed(1)}/${player.getCarryCapacity().toFixed(1)} kg.`, timeCostMinutes: 1, changes: [] };
        }
        player.gold -= buyPrice;
        merchant.gold += buyPrice;
        player.addItem(item.id, 1);
        stock.quantity -= 1;
        changes.push(new WorldChange('item_bought', item.id, 1, `Bought ${item.name}`, 'local'));
        changes.push(new WorldChange('gold_changed', player.name, -buyPrice, `Wydano ${buyPrice} złota.`, 'local'));
        return { success: true, message: `Kupujesz ${item.name} za ${buyPrice} złota.`, timeCostMinutes: 5, changes };
    }

    _tryEquipmentAction(normalizedAction, player) {
        const wantsUnequip = /\b(zdejmij|zdejmuję|zdejmuje|unequip|odłóż|odloz)\w*/i.test(normalizedAction);
        const wantsEquip = /\b(załóż|zaloz|zakładam|zakladam|wyposaż|wyposaz|equip|ubierz)\w*/i.test(normalizedAction);
        if (!wantsEquip && !wantsUnequip) return null;

        const item = this._resolveItemInAction(normalizedAction);
        if (wantsUnequip) {
            const target = item?.id || normalizedAction.match(/\b(weapon|armor|offhand|accessory|broń|bron|zbroja|tarcza|amulet)\b/i)?.[1];
            const slotAliases = { broń: 'weapon', bron: 'weapon', zbroja: 'armor', tarcza: 'offhand', amulet: 'accessory' };
            const slotOrItemId = slotAliases[target] || target;
            if (!player.unequipItem(slotOrItemId)) {
                return { success: false, message: 'Nie masz takiego przedmiotu założonego.', timeCostMinutes: 1, changes: [] };
            }
            return {
                success: true,
                message: `Zdejmujesz ${item?.name || 'wyposażenie'}.`,
                timeCostMinutes: 1,
                changes: [new WorldChange('item_unequipped', item?.id || slotOrItemId, true, 'Przedmiot zdjęty.', 'local')]
            };
        }

        if (!item) return { success: false, message: 'Podaj przedmiot, który chcesz założyć.', timeCostMinutes: 1, changes: [] };
        if (!item.slot) return { success: false, message: `${item.name} nie jest przedmiotem, który można założyć.`, timeCostMinutes: 1, changes: [] };
        if (player.getItemQuantity(item.id) < 1) return { success: false, message: `Nie masz przedmiotu: ${item.name}.`, timeCostMinutes: 1, changes: [] };
        const previous = player.equipment?.[item.slot];
        player.equipItem(item.id);
        const changes = [new WorldChange('item_equipped', item.id, { slot: item.slot, previous }, `Założono ${item.name}.`, 'local')];
        if (previous && previous !== item.id) changes.push(new WorldChange('item_unequipped', previous, true, 'Poprzedni przedmiot zastąpiony.', 'local'));
        return { success: true, message: `Zakładasz ${item.name}.`, timeCostMinutes: 1, changes };
    }

    _tryQuestAction(normalizedAction, player) {
        if (!/(quest|zadanie|misja|przyjmij|accept|nagrod|reward)/i.test(normalizedAction)) return null;
        const questGivers = Array.from(this.npcs.values()).filter(npc =>
            npc.locationId === player.locationId && npc.isAlive !== false && npc.isQuestGiver
        );
        if (questGivers.length === 0) return { success: false, message: 'Nie ma tu osoby, ktora oferuje zadanie.', timeCostMinutes: 1, changes: [] };
        const available = this.questDefinitions.filter(quest => questGivers.some(questGiver =>
            this._questIsAvailableToGiver(quest, questGiver, player)
        ));
        const explicit = available.find(quest => {
            const id = String(quest.id || '').toLocaleLowerCase('pl-PL');
            const title = String(quest.title || '').toLocaleLowerCase('pl-PL');
            return (id && normalizedAction.includes(id)) || (title && normalizedAction.includes(title));
        });
        const quest = explicit || available[0] || (this.questDefinitions.length === 0 && !player.getQuest('forest_threat') ? this._getStarterQuest() : null);
        if (!quest) {
            const statuses = player.quests.length
                ? player.quests.map(item => `${item.title}: ${item.status}`).join(', ')
                : 'brak przyjetych zadan';
            return { success: true, message: `Nie ma tu kolejnych dostepnych zadan (${statuses}).`, timeCostMinutes: 1, changes: [] };
        }
        const accepted = { ...quest, status: 'active', objective: { ...(quest.objective || {}), progress: 0 }, reward: { ...(quest.reward || {}) } };
        if (!player.addQuest(accepted)) {
            return { success: true, message: `Zadanie "${quest.title}" ma juz status: ${player.getQuest(quest.id)?.status || 'przyjete'}.`, timeCostMinutes: 1, changes: [] };
        }
        const changes = [new WorldChange('quest_accepted', accepted.id, true, accepted.title, 'local')];
        if (accepted.objective.type === 'explore' && accepted.objective.targetId === player.locationId) {
            this._completeQuest(player, player.getQuest(accepted.id), changes);
        }
        return {
            success: true,
            message: `Przyjmujesz zadanie: ${accepted.title}.`,
            timeCostMinutes: 2,
            changes
        };
    }

    _getNpcArmorClass(npc) {
        if (Number.isFinite(npc?.armorClass)) return Math.max(1, Math.floor(npc.armorClass));
        return Math.max(1, 10 + Math.floor(Number(npc?.defense) || 0));
    }

    _rollPlayerDamage(player, critical = false) {
        const profile = player.getDamageProfile?.() || {
            dice: '1d4',
            bonus: 0,
            weaponName: 'pięść'
        };
        const parsed = parseDiceNotation(profile.dice, '1d4');
        const rolled = rollDice(`${critical ? parsed.count * 2 : parsed.count}d${parsed.sides}`, '1d4');
        return {
            ...rolled,
            bonus: Math.floor(Number(profile.bonus) || 0),
            total: Math.max(1, rolled.total + Math.floor(Number(profile.bonus) || 0)),
            weaponName: profile.weaponName,
            critical
        };
    }

    _rollNpcDamage(npc, player) {
        const rolled = rollDice(npc?.damageDice, '1d6');
        const attackBonus = Math.max(0, Math.floor(Number(npc?.attack) || 0) - 5);
        const defense = Math.max(0, Math.floor(player?.getDefensePower?.() || 0));
        return {
            ...rolled,
            bonus: attackBonus,
            mitigation: defense,
            total: Math.max(1, rolled.total + attackBonus - defense)
        };
    }

    _applyNpcLoot(player, target, changes) {
        const remaining = [];
        for (const entry of Array.isArray(target?.loot) ? target.loot : []) {
            const item = ITEM_CATALOG[entry.id];
            const quantity = Math.max(0, Math.floor(Number(entry.quantity) || 0));
            if (!item || quantity < 1) continue;
            const canTake = player.canCarry?.(item.id, quantity) ? quantity : (player.canCarry?.(item.id, 1) ? 1 : 0);
            if (canTake > 0) {
                player.addItem(item.id, canTake);
                changes.push(new WorldChange('item_looted', item.id, canTake, `Zdobyto: ${item.name} x${canTake}.`, 'local'));
            }
            if (canTake < quantity) remaining.push({ id: item.id, quantity: quantity - canTake });
        }
        target.loot = remaining;
        return changes;
    }

    _tryCombatAction(normalizedAction, player) {
        if (player.isDowned) return { success: false, message: 'Jesteś powalony. Ktoś musi ci pomóc albo musisz zostać uleczony.', timeCostMinutes: 1, changes: [] };
        if (player.stamina < 5) return { success: false, message: 'Brakuje ci staminy na atak.', timeCostMinutes: 1, changes: [] };
        const target = this._findNpcInAction(normalizedAction, player, true);
        if (!target) return { success: false, message: 'Nie ma tu celu walki.', timeCostMinutes: 1, changes: [] };
        player.stamina -= 5;
        const changes = [];
        const damageRoll = this._rollPlayerDamage(player);
        const damage = Math.max(1, damageRoll.total - Math.floor(Number(target.defense) || 0));
        target.hp = Math.max(0, target.hp - damage);
        changes.push(new WorldChange('combat_happened', target.id, damage, `Trafiasz ${target.name} za ${damage} obrażeń (${damageRoll.notation}${damageRoll.bonus ? ` ${damageRoll.bonus >= 0 ? '+' : ''}${damageRoll.bonus}` : ''}).`, 'local'));
        if (target.hp <= 0) {
            target.isAlive = false;
            player.gold += target.goldReward;
            const levelsGained = player.gainXp(target.xpReward);
            this._applyNpcLoot(player, target, changes);
            changes.push(new WorldChange('npc_killed', target.id, true, `${target.name} was defeated`, 'local'));
            if (target.goldReward > 0) changes.push(new WorldChange('gold_changed', player.name, target.goldReward, 'Looted gold', 'local'));
            if (target.xpReward > 0) changes.push(new WorldChange('xp_gained', player.name, target.xpReward, 'Gained experience', 'local'));
            this._completeKillQuests(player, target, changes);
            return { success: true, message: `Pokonujesz przeciwnika: ${target.name}.`, timeCostMinutes: 2, changes };
        }
        const retaliationRoll = this._rollNpcDamage(target, player);
        const retaliation = retaliationRoll.total;
        player.hp = Math.max(0, player.hp - retaliation);
        changes.push(new WorldChange('player_damaged', player.name, -retaliation, `${target.name} odpowiada ciosem za ${retaliation} HP (${retaliationRoll.notation}).`, 'local'));
        if (player.hp <= 0) {
            player.isDowned = true;
            changes.push(new WorldChange('player_downed', player.name, true, 'Postać zostaje powalona.', 'local'));
        }
        return { success: true, message: `Ranisz ${target.name}, ale przeciwnik odpowiada ciosem za ${retaliation} HP.`, timeCostMinutes: 2, changes };
    }

    // ====================================================================
    // SEPARATE COMBAT MODE
    // ====================================================================

    _cloneCombatState() {
        return this.combatState ? JSON.parse(JSON.stringify(this.combatState)) : null;
    }

    _combatParticipantSnapshot(id, type, name, playerOrNpc, initiative = 0) {
        const entity = playerOrNpc || {};
        const isPlayer = type === 'player';
        return {
            id: String(id || name || type),
            type,
            name: String(name || entity.name || type),
            hp: Math.max(0, Math.floor(Number(entity.hp) || 0)),
            maxHp: Math.max(1, Math.floor(Number(entity.maxHp) || 1)),
            armorClass: isPlayer
                ? Math.max(1, Math.floor(entity.getArmorClass?.() || 10))
                : this._getNpcArmorClass(entity),
            initiative: Math.floor(Number(initiative) || 0),
            downed: isPlayer ? entity.isDowned === true : entity.isAlive === false
        };
    }

    getCombatState() {
        return this._cloneCombatState();
    }

    startCombat(player, targetId, options = {}) {
        if (!player) return { success: false, message: 'Brak aktywnego gracza.', combatState: null };
        if (this.combatState?.status === 'active') {
            return { success: false, message: 'Walka już trwa.', combatState: this.getCombatState() };
        }

        const target = this.npcs.get(String(targetId || ''));
        if (!target || target.locationId !== player.locationId || target.isAlive === false) {
            return { success: false, message: 'Cel walki nie jest dostępny w tej lokacji.', combatState: null };
        }
        if (player.isDowned) return { success: false, message: 'Postać jest powalona.', combatState: null };

        const requestedParty = Array.isArray(options.partyMembers) ? options.partyMembers : [];
        const party = requestedParty
            .filter(entry => entry?.player && entry.player.locationId === player.locationId && entry.player.isDowned !== true)
            .map(entry => ({
                id: String(entry.id || entry.playerId || entry.player.name),
                player: entry.player,
                name: entry.name || entry.player.name
            }));
        if (!party.some(entry => entry.player === player)) {
            party.unshift({
                id: String(options.actorId || player.name || 'player'),
                player,
                name: player.name
            });
        }

        const partyParticipants = party.map(entry => {
            const initiative = rollDice('1d20').total + (entry.player.getAbilityModifier?.('dexterity') || 0);
            return {
                entry,
                initiative,
                snapshot: this._combatParticipantSnapshot(entry.id, 'player', entry.name, entry.player, initiative)
            };
        });
        const npcInitiative = rollDice('1d20').total;
        const firstActor = String(options.actorId || partyParticipants[0]?.entry.id || player.name || 'player');
        const combatId = `combat:${this.currentTimeMinutes}:${Date.now()}`;

        this.combatState = {
            version: 1,
            id: combatId,
            status: 'active',
            round: 1,
            locationId: player.locationId,
            activeActorId: firstActor,
            partyPlayerIds: partyParticipants.map(item => item.entry.id),
            targetId: target.id,
            participants: [
                ...partyParticipants.map(item => item.snapshot),
                this._combatParticipantSnapshot(target.id, 'npc', target.name, target, npcInitiative)
            ],
            log: [],
            startedAtGameTime: this.currentTimeMinutes,
            endedAtGameTime: null,
            summary: null
        };
        return {
            success: true,
            message: `Walka rozpoczęła się: ${target.name}.`,
            combatState: this.getCombatState()
        };
    }

    getCombatAttackCheck(player, targetId = this.combatState?.targetId) {
        if (!player || this.combatState?.status !== 'active') return null;
        const target = this.npcs.get(String(targetId || ''));
        if (!target || target.isAlive === false) return null;
        // A combat encounter owns the scene until it ends. Time-dependent NPC
        // movement or a stale multiplayer character snapshot must not make a
        // living combatant disappear between two legal turns.
        const combatLocationId = this.combatState.locationId || player.locationId;
        if (target.locationId !== combatLocationId) target.locationId = combatLocationId;
        if (player.locationId !== combatLocationId) player.locationId = combatLocationId;
        const modifier = (player.getAbilityModifier?.('strength') || 0)
            + (Number.isFinite(player.proficiencyBonus) ? player.proficiencyBonus : 2);
        const difficulty = this._getNpcArmorClass(target);
        return {
            kind: 'attack',
            combatMode: true,
            ability: 'strength',
            skill: 'attack',
            label: `Atak: ${target.name}`,
            targetId: target.id,
            targetName: target.name,
            difficulty,
            modifier,
            reason: `Pancerz celu: ${difficulty}`
        };
    }

    _syncCombatParticipants(player, target, actorId = this.combatState?.activeActorId) {
        if (!this.combatState) return;
        const entities = new Map([
            [String(this.combatState.targetId), { type: 'npc', name: target?.name, value: target }],
            [String(actorId || player?.name || 'player'), { type: 'player', name: player?.name, value: player }]
        ]);
        for (const participant of this.combatState.participants || []) {
            const entity = entities.get(String(participant.id));
            if (!entity?.value) continue;
            const value = entity.value;
            participant.name = String(entity.name || value.name || participant.name);
            participant.hp = Math.max(0, Math.floor(Number(value.hp) || 0));
            participant.maxHp = Math.max(1, Math.floor(Number(value.maxHp) || participant.maxHp || 1));
            participant.downed = entity.type === 'player' ? value.isDowned === true : value.isAlive === false;
            participant.armorClass = entity.type === 'player'
                ? Math.max(1, Math.floor(value.getArmorClass?.() || participant.armorClass || 10))
                : this._getNpcArmorClass(value);
        }
    }

    _appendCombatLog(entry) {
        if (!this.combatState) return;
        this.combatState.log = Array.isArray(this.combatState.log) ? this.combatState.log : [];
        this.combatState.log.push({ ...entry, round: this.combatState.round });
        if (this.combatState.log.length > 40) this.combatState.log = this.combatState.log.slice(-40);
    }

    _resolveNpcCombatTurn(target, player) {
        const attackRoll = rollDice('1d20').total;
        const attackBonus = Math.max(0, Math.floor(Number(target?.attack) || 0) - 5);
        const difficulty = Math.max(1, Math.floor(player?.getArmorClass?.() || 10));
        const total = attackRoll + attackBonus;
        const criticalSuccess = attackRoll === 20;
        const criticalFailure = attackRoll === 1;
        const hit = criticalSuccess || (!criticalFailure && total >= difficulty);
        const changes = [new WorldChange(
            'combat_npc_attack',
            target?.id || 'npc',
            { roll: attackRoll, bonus: attackBonus, total, difficulty, hit },
            hit
                ? `${target.name} trafia w ${player.name} (${attackRoll} + ${attackBonus} przeciwko ${difficulty}).`
                : `${target.name} nie trafia (${attackRoll} + ${attackBonus} przeciwko ${difficulty}).`,
            'local'
        )];
        let damage = 0;
        let damageRoll = null;
        if (hit) {
            damageRoll = this._rollNpcDamage(target, player);
            damage = damageRoll.total;
            player.hp = Math.max(0, player.hp - damage);
            changes.push(new WorldChange(
                'player_damaged',
                player.name,
                -damage,
                `${target.name} zadaje ${damage} obrażeń (${damageRoll.notation}).`,
                'local'
            ));
            if (player.hp <= 0) {
                player.isDowned = true;
                changes.push(new WorldChange('player_downed', player.name, true, 'Postać zostaje powalona.', 'local'));
            }
        }
        return {
            changes,
            entry: {
                actorId: target?.id || 'npc',
                actorName: target?.name || 'Przeciwnik',
                action: 'attack',
                roll: attackRoll,
                total,
                difficulty,
                success: hit,
                damage,
                targetId: player?.name || 'player',
                targetName: player?.name || 'Gracz',
                text: hit ? `${target.name} trafia za ${damage}.` : `${target.name} pudłuje.`
            }
        };
    }

    _finishCombat(player, target, outcome) {
        if (!this.combatState) return null;
        const rewardGold = Math.max(0, Math.floor(Number(target?.goldReward) || 0));
        const rewardXp = Math.max(0, Math.floor(Number(target?.xpReward) || 0));
        const summary = {
            outcome,
            targetId: target?.id || null,
            targetName: target?.name || 'przeciwnik',
            locationId: this.combatState.locationId,
            rounds: this.combatState.round,
            playerName: player?.name || 'Gracz',
            playerHp: Math.max(0, Math.floor(Number(player?.hp) || 0)),
            playerMaxHp: Math.max(1, Math.floor(Number(player?.maxHp) || 1)),
            rewardGold,
            rewardXp,
            text: outcome === 'victory'
                ? `Walka zakończona zwycięstwem nad ${target?.name || 'przeciwnikiem'}. Zdobyto ${rewardXp} XP${rewardGold ? ` i ${rewardGold} złota` : ''}.`
                : outcome === 'downed'
                    ? `${player?.name || 'Gracz'} został powalony w walce z ${target?.name || 'przeciwnikiem'}.`
                    : `Walka z ${target?.name || 'przeciwnikiem'} została zakończona.`
        };
        this.combatState.status = 'completed';
        this.combatState.outcome = outcome;
        this.combatState.activeActorId = null;
        this.combatState.endedAtGameTime = this.currentTimeMinutes;
        this.combatState.summary = summary;
        return summary;
    }

    resolveCombatAction(action, player, check, rollValue, actorId = null) {
        if (!this.combatState || this.combatState.status !== 'active') {
            return new ActionResult(false, 'Brak aktywnej walki.', 1);
        }
        const expectedActorId = String(this.combatState.activeActorId || '');
        if (actorId && expectedActorId && String(actorId) !== expectedActorId) {
            return new ActionResult(false, 'To nie jest tura tej postaci.', 1);
        }
        const target = this.npcs.get(String(this.combatState.targetId || check?.targetId || ''));
        if (!target || target.isAlive === false) {
            const result = new ActionResult(false, 'Przeciwnik nie jest już dostępny.', 1);
            result.combatState = this.getCombatState();
            return result;
        }
        if (player.isDowned) return new ActionResult(false, 'Postać jest powalona.', 1);
        if (player.stamina < 5) return new ActionResult(false, 'Brakuje ci staminy na atak.', 1);
        const combatCheck = { ...(check || this.getCombatAttackCheck(player, target.id)), combatMode: true, kind: 'attack', targetId: target.id };
        const result = this.resolveD20Action(action, player, combatCheck, rollValue);
        const npcChanges = [];
        const playerRoll = result.worldChanges?.find(change => change.type === 'd20_rolled')?.delta || {};
        this._appendCombatLog({
            actorId: actorId || expectedActorId || player.name,
            actorName: player.name,
            action: 'attack',
            roll: playerRoll.roll || rollValue,
            total: playerRoll.total || null,
            difficulty: playerRoll.difficulty || combatCheck.difficulty,
            success: result.success === true,
            damage: result.worldChanges?.find(change => change.type === 'combat_happened')?.delta || 0,
            targetId: target.id,
            targetName: target.name,
            text: result.message
        });

        let combatSummary = null;
        if (target.isAlive === false) {
            combatSummary = this._finishCombat(player, target, 'victory');
        } else if (player.isDowned) {
            combatSummary = this._finishCombat(player, target, 'downed');
        } else {
            const npcTurn = this._resolveNpcCombatTurn(target, player);
            result.worldChanges.push(...npcTurn.changes);
            npcChanges.push(...npcTurn.changes);
            this._appendCombatLog(npcTurn.entry);
            if (player.isDowned) {
                combatSummary = this._finishCombat(player, target, 'downed');
            } else {
                const partyIds = this.combatState.partyPlayerIds || [expectedActorId];
                const index = Math.max(0, partyIds.indexOf(expectedActorId));
                const nextIndex = (index + 1) % partyIds.length;
                this.combatState.activeActorId = partyIds[nextIndex] || expectedActorId;
                if (nextIndex === 0) this.combatState.round += 1;
            }
        }
        this._syncCombatParticipants(player, target, actorId || expectedActorId);
        if (combatSummary) this.recordCombatSummary(combatSummary);
        result.combatState = this.getCombatState();
        result.combatSummary = combatSummary;
        for (const change of npcChanges) this.logWorldChange(change);
        return result;
    }

    recordCombatSummary(summary) {
        if (!summary?.text) return false;
        this.recordPlayerAction('combat_summary', {
            description: summary.text,
            scope: 'local',
            delta: {
                outcome: summary.outcome,
                targetId: summary.targetId,
                rewardGold: summary.rewardGold,
                rewardXp: summary.rewardXp
            }
        });
        return true;
    }

    /**
     * Resolve an action after the server-authoritative d20 roll is complete.
     * The narrator receives this result later; it cannot invent a hit, damage
     * or success that is not returned here.
     */
    resolveD20Action(action, player, check, rollValue) {
        if (!player || !check || !Number.isInteger(rollValue) || rollValue < 1 || rollValue > 20) {
            return new ActionResult(false, 'Nieprawidłowy test kości.', 1);
        }
        if (player.isDowned) {
            return new ActionResult(false, 'Jesteś powalony. Najpierw musisz zostać uleczony.', 1);
        }
        const roll = rollValue;
        const modifier = Number.isFinite(check.modifier) ? Math.floor(check.modifier) : 0;
        const difficulty = Number.isFinite(check.difficulty) ? Math.max(1, Math.floor(check.difficulty)) : 10;
        const total = roll + modifier;
        const criticalSuccess = roll === 20;
        const criticalFailure = roll === 1;
        const success = criticalSuccess || (!criticalFailure && total >= difficulty);
        const changes = [new WorldChange(
            'd20_rolled',
            player.name,
            { roll, modifier, total, difficulty, success, criticalSuccess, criticalFailure },
            `${check.label || 'Test'}: d20 ${roll} ${modifier >= 0 ? '+' : ''}${modifier} = ${total} przeciwko ${difficulty}`,
            'local'
        )];

        if (check.kind === 'attack') {
            const target = this.npcs.get(check.targetId);
            const combatLocationId = check.combatMode && this.combatState?.status === 'active'
                ? this.combatState.locationId
                : player.locationId;
            if (check.combatMode && combatLocationId) {
                if (player.locationId !== combatLocationId) player.locationId = combatLocationId;
                if (target && target.locationId !== combatLocationId) target.locationId = combatLocationId;
            }
            if (!target || target.locationId !== combatLocationId || target.isAlive === false) {
                return new ActionResult(false, 'Cel walki nie jest już dostępny.', 1, changes);
            }
            if (player.stamina < 5) {
                return new ActionResult(false, 'Brakuje ci staminy na atak.', 1, changes);
            }
            player.stamina -= 5;
            if (success) {
                const damageRoll = this._rollPlayerDamage(player, criticalSuccess);
                const damage = Math.max(1, damageRoll.total - Math.floor(Number(target.defense) || 0));
                target.hp = Math.max(0, target.hp - damage);
                changes.push(new WorldChange('combat_happened', target.id, damage, `Trafiasz ${target.name} za ${damage} obrażeń (${damageRoll.notation}${damageRoll.bonus ? ` ${damageRoll.bonus >= 0 ? '+' : ''}${damageRoll.bonus}` : ''}${criticalSuccess ? ', krytyczne trafienie' : ''}).`, 'local'));
                if (target.hp <= 0) {
                    target.isAlive = false;
                    player.gold += target.goldReward;
                    player.gainXp(target.xpReward);
                    this._applyNpcLoot(player, target, changes);
                    changes.push(new WorldChange('npc_killed', target.id, true, `${target.name} zostaje pokonany.`, 'local'));
                    if (target.goldReward > 0) changes.push(new WorldChange('gold_changed', player.name, target.goldReward, 'Zdobyto złoto.', 'local'));
                    if (target.xpReward > 0) changes.push(new WorldChange('xp_gained', player.name, target.xpReward, 'Zdobyto doświadczenie.', 'local'));
                    this._completeKillQuests(player, target, changes);
                    const result = new ActionResult(true, `Trafiasz ${target.name} i pokonujesz przeciwnika.`, 2, changes);
                    this.advanceWorldTimeForPlayer(player, result.timeCostMinutes, { suppressHpRegen: check.combatMode === true });
                    for (const change of result.worldChanges) this.logWorldChange(change);
                    return result;
                }
                const result = new ActionResult(true, `Trafiasz ${target.name}. Przeciwnik traci ${damage} HP.`, 2, changes);
                this.advanceWorldTimeForPlayer(player, result.timeCostMinutes, { suppressHpRegen: check.combatMode === true });
                for (const change of result.worldChanges) this.logWorldChange(change);
                return result;
            }
            // The separate combat panel resolves the defender's turn itself.
            // Legacy narrator actions retain the old immediate retaliation.
            if (!check.combatMode) {
                const retaliationRoll = this._rollNpcDamage(target, player);
                const retaliation = retaliationRoll.total;
                player.hp = Math.max(0, player.hp - retaliation);
                changes.push(new WorldChange('player_damaged', player.name, -retaliation, `${target.name} unika i kontratakuje za ${retaliation} HP (${retaliationRoll.notation}).`, 'local'));
                if (player.hp <= 0) {
                    player.isDowned = true;
                    changes.push(new WorldChange('player_downed', player.name, true, 'Postać zostaje powalona.', 'local'));
                }
            }
            const result = new ActionResult(false, player.isDowned
                ? `Nie trafiasz ${target.name}; kontratak powala twoją postać.`
                : check.combatMode
                    ? `Nie trafiasz ${target.name}.`
                    : `Nie trafiasz ${target.name}; przeciwnik robi unik i kontratakuje.`, 2, changes);
            this.advanceWorldTimeForPlayer(player, result.timeCostMinutes, { suppressHpRegen: check.combatMode === true });
            for (const change of result.worldChanges) this.logWorldChange(change);
            return result;
        }

        const message = success
            ? `${check.label || 'Test'} zakończony sukcesem: ${total} przeciwko ${difficulty}.`
            : `${check.label || 'Test'} nieudany: ${total} przeciwko ${difficulty}.`;
        changes.push(new WorldChange('d20_check_resolved', player.name, success, message, 'local'));
        const result = new ActionResult(success, message, 5, changes);
        this.advanceWorldTimeForPlayer(player, result.timeCostMinutes);
        for (const change of result.worldChanges) this.logWorldChange(change);
        return result;
    }

    _completeKillQuests(player, target, changes) {
        for (const quest of player.quests) {
            if (quest.status !== 'active' || !['kill_npc', 'defeat'].includes(quest.objective?.type) || quest.objective.targetId !== target.id) continue;
            this._completeQuest(player, quest, changes);
        }
    }

    _parseTimeIntent(normalizedAction) {
        const text = String(normalizedAction || '').trim().toLocaleLowerCase('pl-PL');
        if (!text) return null;

        const waitVerb = /\b(czekam|czekamy|czekaj|czekajmy|poczekam|poczekaj|poczekamy|przeczekam|przeczekamy|odczekam|odczekamy)\b/i.test(text);
        const timePhrase = /\b(rano|ranek|rana|świt|swit|południe|poludnie|popołudnie|popoludnie|wieczór|wieczor|noc|północ|polnoc|godzina|godziny|godzinę|godz|minut|minute|minuty)\b/i.test(text);
        const timeStatement = /\b(jest|mamy|będzie|bedzie|nastał|nastal|nastała|nastala)\b/i.test(text) && timePhrase;
        if (!waitVerb && !timeStatement) return null;

        const durationMatch = text.match(/\b(\d{1,4})\s*(godzin(?:a|y|ę)?|h|minut(?:a|y|ę)?|min)\b/i);
        if (durationMatch) {
            const amount = Number(durationMatch[1]);
            const unit = durationMatch[2].toLocaleLowerCase('pl-PL');
            if (Number.isInteger(amount) && amount > 0 && amount <= 1000) {
                const minutes = /godzin|\bh\b/i.test(unit) ? amount * 60 : amount;
                return {
                    minutes,
                    label: `${amount} ${/godzin|\bh\b/i.test(unit) ? 'godz.' : 'min.'}`
                };
            }
        }

        const numericMatch = text.match(/\b(?:godzina|godziny|godzinę|godz|o)\s*(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\b/i)
            || text.match(/\b(?:do|jest|będzie|bedzie)\s+(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\b/i);
        if (numericMatch) {
            const hour = Number(numericMatch[1]);
            const minute = numericMatch[2] === undefined ? 0 : Number(numericMatch[2]);
            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                const dayMinutes = 24 * 60;
                const currentDayMinute = ((this.currentTimeMinutes % dayMinutes) + dayMinutes) % dayMinutes;
                const targetMinute = (hour * 60) + minute;
                let minutes = targetMinute - currentDayMinute;
                if (minutes < 0) minutes += dayMinutes;
                return {
                    minutes,
                    label: `godziny ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
                };
            }
        }

        const periods = [
            { pattern: /\b(?:ranek|rano|rana|świt|swit)\b/i, hour: 6, label: 'rana' },
            { pattern: /\b(?:południe|poludnie|popołudnie|popoludnie)\b/i, hour: 12, label: 'południa' },
            { pattern: /\b(?:wieczór|wieczor)\b/i, hour: 18, label: 'wieczoru' },
            { pattern: /\b(?:noc)\b/i, hour: 22, label: 'nocy' },
            { pattern: /\b(?:północ|polnoc)\b/i, hour: 0, label: 'północy' }
        ];
        const period = periods.find(candidate => candidate.pattern.test(text));
        if (period) {
            const dayMinutes = 24 * 60;
            const currentDayMinute = ((this.currentTimeMinutes % dayMinutes) + dayMinutes) % dayMinutes;
            let minutes = (period.hour * 60) - currentDayMinute;
            if (minutes < 0) minutes += dayMinutes;
            return { minutes, label: period.label };
        }

        if (waitVerb) return { minutes: 10, label: '10 minut' };
        return null;
    }

    /**
     * Resolve the small set of actions that the engine can currently prove.
     * The narrator may embellish the result, but it cannot invent a state
     * change that was not returned here.
     */
    performPlayerAction(action, player = this.player) {
        if (!player) {
            return new ActionResult(false, "Brak aktywnego gracza.", 1);
        }

        const text = String(action || '').trim();
        if (!text) {
            return new ActionResult(false, "Akcja nie może być pusta.", 1);
        }

        const normalized = text.toLocaleLowerCase('pl-PL');
        // Sandbox accepts common speech-like travel forms. In particular,
        // people often type "ide d osklepu" instead of "ide do sklepu";
        // repair only this harmless separator typo before parsing the route.
        const normalizedForParsing = this.isSandbox
            ? normalized.replace(/\bd\s+o(?=[a-ząćęłńóśźż])/gi, 'do ')
            : normalized;
        const changes = [];
        this._ensureSandboxNpcFromAction(normalizedForParsing, player, changes);
        let success = true;
        let message = "Akcja została przekazana narratorowi.";
        let timeCostMinutes = 10;
        const timeIntent = this._parseTimeIntent(normalized);

        let targetLocation = this._findLocationInAction(normalizedForParsing);
        // Rozpoznawaj zarówno rozkazy, jak i naturalne deklaracje gracza:
        // „idź do…”, „idziemy do…”, „ruszamy do…”, „chodźmy do…”.
        // Dzięki temu takie zdanie nie zostanie błędnie przekazane narratorowi
        // jako akcja, która może samowolnie zmienić miejsce sceny.
        const travelIntent = /\b(idźmy|idzmy|idziemy|idę|ide|idź|idz|udajmy|udajmy się|udajemy|udajemy się|udaj|ruszmy|ruszmy się|ruszamy|ruszamy się|rusz|chodźmy|chodzmy|chodzimy|chodź|chodz|podążajmy|podazajmy|podążamy|podazamy|podąż|podaz|przenieśmy|przeniesmy|przenieś|przenies|jedźmy|jedzmy|jedziemy|jedź|jedz|wędrujmy|wedrujmy|wędrujemy|wedrujemy|wędruj|wedruj|podróżujmy|podrozujmy|podróżujemy|podrozujemy|podróżuj|podrozuj)\b/i.test(normalizedForParsing);

        const extendedTravelIntent = /\b(kieruję się|kieruje sie|zmierzam|płynę|plyne|płyniemy|plyniemy|lecę|lece|lecimy|teleportuję się|teleportuje sie|udaję się|udaje sie|chcę iść|chce isc|wsiadam do|wracam|wracamy|wróć|wroc|powrót|powrot)\b/i.test(normalizedForParsing);
        const implicitSandboxTravel = this.isSandbox && /^(?:do|na|w|we|ku|przez|w stronę|w strone)\s+\S+/i.test(normalizedForParsing);
        const wantsTravel = travelIntent || extendedTravelIntent || implicitSandboxTravel;
        if (this.isSandbox && wantsTravel && !targetLocation && !timeIntent) {
            targetLocation = this._createSandboxLocation(this._extractSandboxDestination(normalizedForParsing), player.locationId);
        }

        if (timeIntent) {
            timeCostMinutes = Math.max(1, timeIntent.minutes);
            message = timeIntent.minutes > 0
                ? `Czekasz do ${timeIntent.label}. Mija ${timeCostMinutes} min.`
                : `Jest już ${timeIntent.label}; mija 1 min.`;
            changes.push(new WorldChange(
                'time_advanced',
                player.name,
                timeCostMinutes,
                message,
                'local'
            ));
        } else if (wantsTravel && targetLocation) {
            const currentLocation = this.getLocation(player.locationId);
            const hasTravelGraph = Array.isArray(currentLocation?.connections) && currentLocation.connections.length > 0;
            const isConnected = this.isSandbox || !hasTravelGraph || currentLocation.connections.includes(targetLocation.id);

            if (!isConnected) {
                success = false;
                message = `Nie mo\u017cna przej\u015b\u0107 bezpo\u015brednio z lokacji "${currentLocation?.name || player.locationId}" do "${targetLocation.name}". Wybierz lokacj\u0119 po\u015bredni\u0105.`;
                timeCostMinutes = 1;
            } else if (player.locationId === targetLocation.id) {
                success = false;
                message = `Jesteś już w lokacji „${targetLocation.name}”.`;
                timeCostMinutes = 1;
            } else {
                const previousLocationId = player.locationId;
                player.locationId = targetLocation.id;
                timeCostMinutes = 30;
                message = `Docierasz do lokacji „${targetLocation.name}”.`;
                changes.push(new WorldChange(
                    'travel_happened',
                    targetLocation.id,
                    { from: previousLocationId, to: targetLocation.id },
                    message,
                    'local'
                ));
                this._completeExploreQuests(player, targetLocation.id, changes);
            }
        } else if (wantsTravel) {
            success = false;
            message = "Nie rozpoznaję celu podróży. Wskaż nazwę istniejącej lokacji.";
            timeCostMinutes = 1;
        } else if (/\b(odpocznij|śpij|spij|prześpij|przespij|połóż się|poloz sie)\b/i.test(normalized)) {
            player.fatigue = Math.max(0, player.fatigue - 35);
            timeCostMinutes = 60;
            message = "Odpoczywasz przez godzinę i odzyskujesz część sił.";
            changes.push(new WorldChange(
                'rest_completed',
                player.name,
                -35,
                message,
                'local'
            ));
        } else if (/\b(rozmaw|pytaj|powiedz|witaj|przywitaj)\w*/i.test(normalized)) {
            timeCostMinutes = 10;
            message = "Rozmowa została zarejestrowana jako akcja fabularna.";
            changes.push(new WorldChange(
                'conversation_happened',
                null,
                true,
                text.substring(0, 120),
                'local'
            ));
        } else if (/\b(kup|kupuję|kupuje|sprzed|handel|targuj)\w*/i.test(normalized)) {
            success = false;
            message = "Handel wymaga jeszcze zdefiniowanego przedmiotu i kupca; narrator nie zmieni złota samym opisem.";
            timeCostMinutes = 5;
        } else if (/\b(atak|walcz|uderz|zabij|strzel)\w*/i.test(normalized)) {
            success = false;
            message = "Walka wymaga celu i statystyk przeciwnika; akcja nie zmieni HP bez mechaniki walki.";
            timeCostMinutes = 5;
        }

        // Resolve richer mechanics after the legacy travel/dialogue branches so
        // old saves and clients keep working while trade/combat/quests become real.
        let mechanicOverride = null;
        if (/\b(załóż|zaloz|zakładam|zakladam|wyposaż|wyposaz|zdejmij|zdejmuję|zdejmuje|unequip|equip|ubierz|odłóż|odloz)\w*/i.test(normalized)) {
            mechanicOverride = this._tryEquipmentAction(normalized, player);
        } else if (/\b(quest|zadanie|misja|przyjmij|accept|nagrod|reward)\b/i.test(normalized)) {
            mechanicOverride = this._tryQuestAction(normalized, player);
        } else if (/\b(use|uzyj|użyj|zjedz|zjedź)\b/i.test(normalized)) {
            mechanicOverride = this._tryUseItem(normalized, player);
        } else if (/\b(kup|kupuj|kupuję|kupuje|sprzed|sprzedaj|sprzedaję|sprzedaje|handel|targuj|buy|sell)\w*/i.test(normalized)) {
            mechanicOverride = this._tryTradeAction(normalized, player);
        } else if (/\b(atak|walcz|uderz|zabij|strzel|attack|fight)\b/i.test(normalized)) {
            mechanicOverride = this._tryCombatAction(normalized, player);
        }
        if (mechanicOverride) {
            success = mechanicOverride.success;
            message = mechanicOverride.message;
            timeCostMinutes = mechanicOverride.timeCostMinutes;
            changes.splice(0, changes.length, ...mechanicOverride.changes);
        }

        const result = new ActionResult(success, message, timeCostMinutes, changes);
        const combatChanges = result.worldChanges.some(change =>
            ['combat_happened', 'player_damaged', 'player_downed', 'npc_killed'].includes(change?.type)
        );
        this.advanceWorldTimeForPlayer(player, result.timeCostMinutes, { suppressHpRegen: combatChanges });
        for (const change of result.worldChanges) {
            this.logWorldChange(change);
        }
        return result;
    }

    _extractSandboxDestination(normalizedAction) {
        const match = String(normalizedAction || '').match(/\b(?:do|w kierunku|w stronę|w strone|ku|na|przez|z powrotem do)\s+(.+?)(?:[,.!?;]|$)/i);
        if (!match) return '';
        return String(match[1] || '')
            .replace(/\s+(?:i|a|żeby|zeby|bo|ale)\s+.*$/i, '')
            .replace(/[.!?;,:]+$/g, '')
            .trim()
            .slice(0, 120);
    }

    _createSandboxLocation(destination, fromLocationId) {
        const cleaned = String(destination || '').replace(/\s+/g, ' ').trim();
        if (cleaned.length < 2) return null;
        const normalizedName = cleaned.toLocaleLowerCase('pl-PL');
        const existing = Array.from(this.locations.values()).find(location =>
            String(location.name || '').toLocaleLowerCase('pl-PL') === normalizedName
        );
        if (existing) return existing;

        const displayName = cleaned.charAt(0).toLocaleUpperCase('pl-PL') + cleaned.slice(1);
        const slug = normalizedName.normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/gi, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 72) || 'miejsce';
        let id = `sandbox_${slug}`;
        let suffix = 2;
        while (this.locations.has(id)) id = `sandbox_${slug}_${suffix++}`;

        const location = new Location(id, displayName);
        location.description = 'Miejsce odkryte podczas swobodnej podróży. Jego szczegóły powstają wraz z grą.';
        location.dangerLevel = 20;
        const origin = this.getLocation(fromLocationId);
        if (origin) {
            if (!origin.connections.includes(id)) origin.connections.push(id);
            location.connections = [origin.id];
        }
        this.addLocation(location);
        return location;
    }

    _findLocationInAction(normalizedAction) {
        for (const location of this.locations.values()) {
            const id = String(location.id).toLocaleLowerCase('pl-PL');
            const name = String(location.name).toLocaleLowerCase('pl-PL');
            if (normalizedAction.includes(id) || normalizedAction.includes(name)) {
                return location;
            }
        }
        return null;
    }

    // ========================================================================
    // PHASE 2: EVENT SYSTEM
    // ========================================================================

    /**
     * Phase 2: Resolve a scheduled world event
     * This function NEVER calls LLM - pure deterministic logic
     * @param {WorldEvent} event 
     */
    resolveEvent(event) {
        const handlers = {
            "war_battle": this._resolveWarBattle.bind(this),
            "war_declared": this._resolveWarDeclared.bind(this),
            "war_ended": this._resolveWarEnded.bind(this),
            "economic_crisis": this._resolveEconomicCrisis.bind(this),
            "npc_move": this._resolveNpcMove.bind(this),
            "assassination_attempt": this._resolveAssassination.bind(this),
            "rebellion": this._resolveRebellion.bind(this),
            "famine": this._resolveFamine.bind(this),
            "plague": this._resolvePlague.bind(this),
            "troop_mobilization": this._resolveStrategicEvent.bind(this),
            "full_mobilization": this._resolveStrategicEvent.bind(this),
            "tax_increase": this._resolveStrategicEvent.bind(this),
            "propaganda_campaign": this._resolveStrategicEvent.bind(this),
            "fortification": this._resolveStrategicEvent.bind(this),
            "troop_repositioning": this._resolveStrategicEvent.bind(this),
            "trade_agreement": this._resolveStrategicEvent.bind(this),
            "resource_boost": this._resolveStrategicEvent.bind(this),
            "espionage": this._resolveStrategicEvent.bind(this),
            "alliance_proposal": this._resolveStrategicEvent.bind(this)
        };

        const handler = handlers[event.type];
        if (handler) {
            const changes = handler(event);
            this._appendWorldChanges(changes);
            
            // Plan follow-up events if needed
            this._planFollowUpEvents(event);
        } else {
            console.warn(`Unhandled event type: ${event.type}`);
        }
    }

    /**
     * Phase 2: Resolve war battle event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveWarBattle(event) {
        const attacker = this.factions.get(event.data.attacker_faction_id || event.data.attackerFactionId || event.data.attackerId);
        const defender = this.factions.get(event.data.defender_faction_id || event.data.defenderFactionId || event.data.targetFactionId);
        const location = this.locations.get(event.data.location_id || event.data.locationId);

        if (!attacker || !defender) {
            console.warn(`Battle aborted: missing faction(s)`);
            return [];
        }

        const ratio = attacker.power / Math.max(defender.power, 1);
        let outcome;
        if (ratio > 1.25) outcome = "attacker_win";
        else if (ratio < 0.8) outcome = "defender_win";
        else outcome = "draw";

        const changes = [];

        if (outcome === "attacker_win") {
            defender.power = Math.max(0, defender.power * 0.82);
            attacker.power = Math.max(0, attacker.power * 0.94);

            if (location) {
                location.controllingFactionId = attacker.id;
                changes.push(new WorldChange(
                    "location_control_changed",
                    location.id,
                    attacker.id,
                    `${attacker.name} captures ${location.name}`,
                    "regional"
                ));
            }

            changes.push(new WorldChange(
                "faction_power_changed",
                defender.id,
                -18,
                `${defender.name} loses power after defeat`,
                "regional"
            ));
        } else if (outcome === "defender_win") {
            attacker.power = Math.max(0, attacker.power * 0.85);
            defender.power = Math.max(0, defender.power * 0.92);

            changes.push(new WorldChange(
                "faction_power_changed",
                attacker.id,
                -15,
                `${attacker.name} fails assault`,
                "regional"
            ));
        } else {
            // Draw - both sides weakened
            attacker.power = Math.max(0, attacker.power * 0.93);
            defender.power = Math.max(0, defender.power * 0.93);

            changes.push(new WorldChange(
                "faction_power_changed",
                attacker.id,
                -7,
                `Stalemate at ${location?.name || 'unknown'}`,
                "regional"
            ));
            changes.push(new WorldChange(
                "faction_power_changed",
                defender.id,
                -7,
                `Stalemate at ${location?.name || 'unknown'}`,
                "regional"
            ));
        }

        return changes;
    }

    /**
     * Phase 2: Resolve war declared event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveWarDeclared(event) {
        const attacker = this.factions.get(event.data.attacker_faction_id || event.data.attackerFactionId || event.data.attackerId);
        const defender = this.factions.get(event.data.defender_faction_id || event.data.defenderFactionId || event.data.targetFactionId);

        if (!attacker || !defender) return [];

        // Track active war
        if (!this.activeWars.has(attacker.id)) {
            this.activeWars.set(attacker.id, new Set());
        }
        this.activeWars.get(attacker.id).add(defender.id);

        // Set hostile relations
        attacker.setRelation(defender.id, -75);
        defender.setRelation(attacker.id, -75);

        return [
            new WorldChange(
                "war_declared",
                attacker.id,
                defender.id,
                `${attacker.name} declares war on ${defender.name}`,
                "global"
            )
        ];
    }

    /**
     * Phase 2: Resolve war ended event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveWarEnded(event) {
        const attacker = this.factions.get(event.data.attacker_faction_id || event.data.attackerFactionId || event.data.attackerId);
        const defender = this.factions.get(event.data.defender_faction_id || event.data.defenderFactionId || event.data.targetFactionId);

        if (!attacker || !defender) return [];

        // Remove from active wars
        if (this.activeWars.has(attacker.id)) {
            this.activeWars.get(attacker.id).delete(defender.id);
        }

        // Improve relations slightly
        attacker.setRelation(defender.id, Math.min(0, attacker.getRelation(defender.id) + 20));
        defender.setRelation(attacker.id, Math.min(0, defender.getRelation(attacker.id) + 20));

        return [
            new WorldChange(
                "war_ended",
                null,
                true,
                `${attacker.name} and ${defender.name} end hostilities`,
                "global"
            )
        ];
    }

    /** Resolve strategy events that modify faction-level state. */
    _resolveStrategicEvent(event) {
        const data = event.data || {};
        const factionId = data.factionId || data.faction_id || data.requesterFactionId || data.attackerFactionId;
        const faction = factionId ? this.factions.get(factionId) : null;
        const changes = [];

        if (faction) {
            switch (event.type) {
                case 'troop_mobilization':
                    faction.resources = Math.max(0, faction.resources - 5);
                    faction.power = Math.min(100, faction.power + 3);
                    break;
                case 'full_mobilization':
                    faction.resources = Math.max(0, faction.resources - 12);
                    faction.power = Math.min(100, faction.power + 8);
                    break;
                case 'tax_increase':
                    faction.resources = Math.min(100, faction.resources + 8);
                    faction.stability = Math.max(0, faction.stability - 4);
                    break;
                case 'propaganda_campaign':
                    faction.stability = Math.min(100, faction.stability + 6);
                    break;
                case 'fortification':
                    faction.resources = Math.max(0, faction.resources - 6);
                    faction.stability = Math.min(100, faction.stability + 5);
                    break;
                case 'troop_repositioning':
                    faction.power = Math.min(100, faction.power + 1);
                    break;
                case 'trade_agreement':
                    faction.resources = Math.min(100, faction.resources + 5);
                    break;
                case 'resource_boost':
                    faction.resources = Math.min(100, faction.resources + 10);
                    break;
                case 'espionage':
                    faction.resources = Math.max(0, faction.resources - 2);
                    break;
                case 'alliance_proposal':
                    if (data.targetFactionId) {
                        faction.setRelation(data.targetFactionId, Math.min(100, faction.getRelation(data.targetFactionId) + 10));
                    }
                    break;
                default:
                    break;
            }

            changes.push(new WorldChange(
                event.type,
                faction.id,
                true,
                `${event.type} resolved for ${faction.name}`,
                'regional'
            ));
        }

        return changes;
    }

    /**
     * Phase 2: Resolve economic crisis event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveEconomicCrisis(event) {
        const location = this.locations.get(event.data.location_id);
        if (!location) return [];

        const severity = event.data.severity / 100;
        location.wealth = Math.max(0, location.wealth - (severity * 40));
        location.stability = Math.max(0, location.stability - (severity * 30));

        const changes = [
            new WorldChange(
                "location_wealth_changed",
                location.id,
                -Math.round(severity * 40),
                `Economic crisis in ${location.name}`,
                "regional"
            )
        ];

        // Update controlling faction resources if applicable
        if (location.controllingFactionId) {
            const faction = this.factions.get(location.controllingFactionId);
            if (faction) {
                faction.resources = Math.max(0, faction.resources - (severity * 20));
                changes.push(new WorldChange(
                    "faction_resources_changed",
                    faction.id,
                    -Math.round(severity * 20),
                    `${faction.name} suffers from economic crisis`,
                    "regional"
                ));
            }
        }

        return changes;
    }

    /**
     * Phase 2: Resolve NPC movement event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveNpcMove(event) {
        const npc = this.npcs.get(event.data.npc_id);
        if (!npc) return [];

        const fromLocation = this.locations.get(event.data.from_location);
        const toLocation = this.locations.get(event.data.to_location);

        npc.locationId = event.data.to_location;

        return [
            new WorldChange(
                "npc_moved",
                npc.id,
                event.data.to_location,
                `${npc.name || npc.id} moves to ${toLocation?.name || event.data.to_location}`,
                "local"
            )
        ];
    }

    /**
     * Phase 2: Resolve assassination attempt
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveAssassination(event) {
        const target = this.npcs.get(event.data.target_npc_id || event.data.targetNpcId);
        if (!target) return [];

        // 50% success chance
        const success = Math.random() < 0.5;

        if (success) {
            // NPC dies or is critically injured
            target.hp = Math.max(1, target.hp - 80);

            return [
                new WorldChange(
                    "npc_killed",
                    target.id,
                    true,
                    `${target.name || target.id} was assassinated`,
                    "regional"
                )
            ];
        } else {
            // Failed attempt - NPC becomes alert
            target.loyalty = Math.min(100, target.loyalty + 20);

            return [
                new WorldChange(
                    "assassination_failed",
                    target.id,
                    event.data.assassin_faction_id,
                    `Assassination attempt on ${target.name || target.id} failed`,
                    "regional"
                )
            ];
        }
    }

    /**
     * Phase 2: Resolve rebellion event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveRebellion(event) {
        const location = this.locations.get(event.data.location_id);
        if (!location) return [];

        const severity = event.data.severity / 100;
        location.stability = Math.max(0, location.stability - (severity * 50));

        // Chance to change controlling faction
        if (severity > 0.6 && location.controllingFactionId) {
            const rebels = this.factions.get(event.data.rebel_faction_id);
            if (rebels && Math.random() < severity) {
                location.controllingFactionId = rebels.id;
                rebels.power = Math.min(100, rebels.power + 10);

                return [
                    new WorldChange(
                        "location_control_changed",
                        location.id,
                        rebels.id,
                        `Rebellion succeeds: ${rebels.name} takes ${location.name}`,
                        "regional"
                    )
                ];
            }
        }

        return [
            new WorldChange(
                "rebellion",
                location.id,
                -Math.round(severity * 50),
                `Rebellion in ${location.name}`,
                "regional"
            )
        ];
    }

    /**
     * Phase 2: Resolve famine event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveFamine(event) {
        const location = this.locations.get(event.data.location_id);
        if (!location) return [];

        const severity = event.data.severity / 100;
        location.population = Math.max(0, Math.floor(location.population * (1 - severity * 0.3)));
        location.wealth = Math.max(0, location.wealth - (severity * 30));
        location.stability = Math.max(0, location.stability - (severity * 40));

        return [
            new WorldChange(
                "famine",
                location.id,
                -Math.round(severity * 100),
                `Famine strikes ${location.name}`,
                "regional"
            )
        ];
    }

    /**
     * Phase 2: Resolve plague event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolvePlague(event) {
        const location = this.locations.get(event.data.location_id);
        if (!location) return [];

        const severity = event.data.severity / 100;
        location.population = Math.max(0, Math.floor(location.population * (1 - severity * 0.4)));
        location.stability = Math.max(0, location.stability - (severity * 35));

        return [
            new WorldChange(
                "plague",
                location.id,
                -Math.round(severity * 100),
                `Plague spreads in ${location.name}`,
                "regional"
            )
        ];
    }

    /**
     * Phase 3: Strategic update - called periodically to plan future events
     * Replaces Phase 2 implementation with explicit goal/strategy tracking
     */
    strategicUpdate() {
        if (this.currentTimeMinutes - this.lastGlobalStrategicUpdate < STRATEGIC_UPDATE_INTERVAL) {
            return;
        }
        this.lastGlobalStrategicUpdate = this.currentTimeMinutes;

        for (const faction of this.factions.values()) {
            if (!faction.isActive()) continue;

            const state = this.evaluateFactionState(faction);
            const strategy = this.selectStrategy(state, faction);
            
            // Check if strategy changed
            if (!faction.currentStrategy || strategy.name !== faction.currentStrategy.name) {
                // Strategy changed - cancel pending events and update
                this.cancelFactionPendingEvents(faction.id);
                faction.currentStrategy = strategy;
                faction.currentStrategy.startTime = this.currentTimeMinutes;
            }

            // Update strategic state cache
            faction.strategicState = state;
            faction.lastStrategicUpdate = this.currentTimeMinutes;

            const plan = this.generatePlan(strategy, faction, state);
            for (const event of plan) {
                this._safeSchedule(event);
            }
        }
    }

    /**
     * Phase 3: Evaluate current state of a faction
     * Returns key metrics for strategy selection
     * @param {Faction} faction 
     * @returns {Object}
     */
    evaluateFactionState(faction) {
        const strongestNeighbor = this.getStrongestNeighbor(faction);
        const militaryAdvantage = strongestNeighbor ? faction.power / strongestNeighbor.power : 1.0;
        
        return {
            militaryAdvantage,                    // >1.0 = advantage
            economicPressure: 100 - faction.resources,
            internalInstability: 100 - faction.stability,
            aggressionLevel: faction.aggression,
            enemyCount: this.countRelationsBelow(faction, -50),
            allyCount: this.countRelationsAbove(faction, 50),
            recentLosses: this.countRecentLosses(faction, 30 * 1440), // last 30 days
            controlledLocations: this._getControlledLocations(faction.id).length,
            totalFactions: this.factions.size
        };
    }

    /**
     * Phase 3: Get strongest neighboring faction
     * @param {Faction} faction 
     * @returns {Faction|null}
     */
    getStrongestNeighbor(faction) {
        let strongest = null;
        let maxPower = 0;

        for (const [id, other] of this.factions) {
            if (id === faction.id) continue;
            if (other.power > maxPower) {
                maxPower = other.power;
                strongest = other;
            }
        }

        return strongest;
    }

    /**
     * Phase 3: Count relations below threshold
     * @param {Faction} faction 
     * @param {number} threshold 
     * @returns {number}
     */
    countRelationsBelow(faction, threshold) {
        let count = 0;
        for (const relation of faction.relations.values()) {
            if (relation <= threshold) count++;
        }
        return count;
    }

    /**
     * Phase 3: Count relations above threshold
     * @param {Faction} faction 
     * @param {number} threshold 
     * @returns {number}
     */
    countRelationsAbove(faction, threshold) {
        let count = 0;
        for (const relation of faction.relations.values()) {
            if (relation >= threshold) count++;
        }
        return count;
    }

    /**
     * Phase 3: Count recent losses (battles/wars in last X minutes)
     * @param {Faction} faction 
     * @param {number} timeWindowMinutes 
     * @returns {number}
     */
    countRecentLosses(faction, timeWindowMinutes) {
        const cutoffTime = this.currentTimeMinutes - timeWindowMinutes;
        let losses = 0;
        
        // Check world log for recent war defeats
        for (const change of this.worldLog) {
            if (change.timestamp && change.timestamp < cutoffTime) continue;
            
            if (change.type === "war_battle" && 
                change.data && 
                change.data.defender_faction_id === faction.id &&
                change.data.victory === false) {
                losses++;
            }
        }
        
        return losses;
    }

    /**
     * Phase 3: Select strategy based on faction state
     * Simple threshold logic (can be replaced with weighted system)
     * @param {Object} state 
     * @param {Faction} faction 
     * @returns {Strategy}
     */
    selectStrategy(state, faction) {
        // Priority 1: Internal stability crisis
        if (state.internalInstability > 65) {
            return new Strategy("internal_stabilization", 0.92);
        }
        
        // Priority 2: Economic pressure
        if (state.economicPressure > 70) {
            return new Strategy("economic_recovery", 0.80);
        }
        
        // Priority 3: Multiple enemies and weak military
        if (state.enemyCount >= 3 && state.militaryAdvantage < 0.9) {
            return new Strategy("defensive", 0.85);
        }
        
        // Priority 4: Strong military, aggressive, no enemies - expansion
        if (state.militaryAdvantage > 1.35 && state.aggressionLevel > 60 && state.enemyCount === 0) {
            return new Strategy("expansion", 0.88);
        }
        
        // Priority 5: Many enemies - coalition
        if (state.enemyCount >= 2) {
            return new Strategy("diplomatic_coalition", 0.75);
        }
        
        // Priority 6: Low stability - covert operations
        if (state.internalInstability > 40 && Math.random() < 0.3) {
            return new Strategy("covert_operations", 0.65);
        }
        
        // Default: maintain status quo
        return new Strategy("maintain_status_quo", 0.70);
    }

    /**
     * Phase 3: Generate event plan based on selected strategy
     * @param {Strategy} strategy 
     * @param {Faction} faction 
     * @param {Object} state 
     * @returns {WorldEvent[]}
     */
    generatePlan(strategy, faction, state) {
        const plan = [];
        const now = this.currentTimeMinutes;

        switch (strategy.name) {
            case "expansion":
                plan.push(this.createEvent("troop_mobilization", now + 3 * 1440, { 
                    factionId: faction.id 
                }));
                plan.push(this.createEvent("war_declared", now + 6 * 1440, { 
                    attackerId: faction.id, 
                    targetFactionId: this.selectExpansionTarget(faction)
                }));
                plan.push(this.createEvent("war_battle", now + 12 * 1440, { 
                    attackerFactionId: faction.id,
                    defenderFactionId: this.selectExpansionTarget(faction),
                    locationId: this.selectExpansionLocation(faction)
                }));
                break;

            case "internal_stabilization":
                plan.push(this.createEvent("tax_increase", now + 2 * 1440, { 
                    factionId: faction.id,
                    locationId: this._getControlledLocations(faction.id)[0]?.id 
                }));
                plan.push(this.createEvent("propaganda_campaign", now + 5 * 1440, { 
                    factionId: faction.id 
                }));
                if (faction.stability < 30) {
                    plan.push(this.createEvent("rebellion", now + this._randomRange(1440, 4320), {
                        locationId: this._getControlledLocations(faction.id)[Math.floor(Math.random() * this._getControlledLocations(faction.id).length)]?.id,
                        severity: 50 + Math.random() * 30
                    }));
                }
                break;

            case "defensive":
                plan.push(this.createEvent("fortification", now + 2 * 1440, { 
                    factionId: faction.id 
                }));
                plan.push(this.createEvent("troop_repositioning", now + 4 * 1440, { 
                    factionId: faction.id 
                }));
                break;

            case "economic_recovery":
                plan.push(this.createEvent("trade_agreement", now + 3 * 1440, { 
                    factionId: faction.id 
                }));
                plan.push(this.createEvent("resource_boost", now + 7 * 1440, { 
                    factionId: faction.id 
                }));
                break;

            case "covert_operations":
                const targetLeader = this.selectKeyEnemyLeader(faction);
                if (targetLeader) {
                    plan.push(this.createEvent("assassination_attempt", now + this._randomRange(5, 15) * 1440, {
                        targetNpcId: targetLeader
                    }));
                }
                plan.push(this.createEvent("espionage", now + this._randomRange(3, 10) * 1440, {
                    factionId: faction.id
                }));
                break;

            case "diplomatic_coalition":
                const potentialAlly = this.selectPotentialAlly(faction);
                if (potentialAlly) {
                    plan.push(this.createEvent("alliance_proposal", now + 2 * 1440, {
                        requesterFactionId: faction.id,
                        targetFactionId: potentialAlly
                    }));
                }
                break;

            case "total_war":
                plan.push(this.createEvent("full_mobilization", now + 1 * 1440, { 
                    factionId: faction.id 
                }));
                const target = this.selectExpansionTarget(faction);
                if (target) {
                    plan.push(this.createEvent("war_declared", now + 2 * 1440, { 
                        attackerId: faction.id, 
                        targetFactionId: target
                    }));
                    plan.push(this.createEvent("war_battle", now + 5 * 1440, { 
                        attackerFactionId: faction.id,
                        defenderFactionId: target,
                        locationId: this.selectExpansionLocation(faction)
                    }));
                }
                break;

            case "maintain_status_quo":
            default:
                // Small random improvements
                if (Math.random() < 0.2) {
                    faction.resources = Math.min(100, faction.resources + 2);
                }
                if (Math.random() < 0.2) {
                    faction.stability = Math.min(100, faction.stability + 2);
                }
                // Occasional NPC movements
                if (Math.random() < 0.3) {
                    const factionNPCs = this._getFactionNPCs(faction.id);
                    if (factionNPCs.length > 0) {
                        const npc = factionNPCs[Math.floor(Math.random() * factionNPCs.length)];
                        const locations = Array.from(this.locations.values());
                        const targetLocation = locations[Math.floor(Math.random() * locations.length)];
                        if (targetLocation.id !== npc.locationId) {
                            plan.push(this.createEvent("npc_move", now + this._randomRange(1440, 7200), {
                                npc_id: npc.id,
                                from_location: npc.locationId,
                                to_location: targetLocation.id
                            }));
                        }
                    }
                }
                break;
        }

        return plan;
    }

    /**
     * Phase 3: Create and return a WorldEvent
     * @param {string} type 
     * @param {number} executeAt 
     * @param {Object} data 
     * @returns {WorldEvent}
     */
    createEvent(type, executeAt, data) {
        const priorityMap = {
            "war_declared": 300,
            "war_battle": 250,
            "rebellion": 200,
            "assassination_attempt": 180,
            "full_mobilization": 170,
            "troop_mobilization": 150,
            "economic_crisis": 150,
            "propaganda_campaign": 100,
            "trade_agreement": 80,
            "npc_move": 50,
            "espionage": 60,
            "fortification": 70,
            "tax_increase": 90,
            "resource_boost": 85,
            "alliance_proposal": 100,
            "troop_repositioning": 80
        };

        const importanceMap = {
            "war_declared": 0.80,
            "war_battle": 0.75,
            "rebellion": 0.70,
            "assassination_attempt": 0.65,
            "full_mobilization": 0.60,
            "troop_mobilization": 0.40,
            "economic_crisis": 0.55,
            "propaganda_campaign": 0.30,
            "trade_agreement": 0.35,
            "npc_move": 0.15,
            "espionage": 0.25,
            "fortification": 0.30,
            "tax_increase": 0.35,
            "resource_boost": 0.30,
            "alliance_proposal": 0.45,
            "troop_repositioning": 0.25
        };

        return new WorldEvent(
            this._generateEventId(),
            type,
            executeAt,
            "regional",
            data,
            priorityMap[type] || 100,
            false,
            data.factionId || data.faction_id || data.attackerFactionId || data.attackerId || data.requesterFactionId || "system",
            importanceMap[type] || 0.3
        );
    }

    /**
     * Phase 3: Select target for expansion
     * @param {Faction} faction 
     * @returns {string|null}
     */
    selectExpansionTarget(faction) {
        let weakest = null;
        let minPower = Infinity;

        for (const [id, other] of this.factions) {
            if (id === faction.id) continue;
            // Don't attack allies
            if (faction.getRelation(other.id) >= 50) continue;
            if (other.power < minPower) {
                minPower = other.power;
                weakest = other;
            }
        }

        return weakest ? weakest.id : null;
    }

    /**
     * Phase 3: Select location for expansion
     * @param {Faction} faction 
     * @returns {string|null}
     */
    selectExpansionLocation(faction) {
        const targetId = this.selectExpansionTarget(faction);
        if (!targetId) return null;
        
        const targetFaction = this.factions.get(targetId);
        if (!targetFaction) return null;

        // Find location controlled by target
        for (const location of this.locations.values()) {
            if (location.controllingFactionId === targetId) {
                return location.id;
            }
        }
        
        return null;
    }

    /**
     * Phase 3: Select key enemy leader for assassination
     * @param {Faction} faction 
     * @returns {string|null}
     */
    selectKeyEnemyLeader(faction) {
        const enemies = Array.from(this.factions.values()).filter(
            f => f.id !== faction.id && faction.getRelation(f.id) <= -50
        );
        
        if (enemies.length === 0) return null;
        
        // Find NPCs belonging to enemy factions
        for (const enemy of enemies) {
            const enemyNPCs = this._getFactionNPCs(enemy.id);
            if (enemyNPCs.length > 0) {
                return enemyNPCs[0].id;
            }
        }
        
        return null;
    }

    /**
     * Phase 3: Select potential ally for coalition
     * @param {Faction} faction 
     * @returns {string|null}
     */
    selectPotentialAlly(faction) {
        const potentialAllies = Array.from(this.factions.values()).filter(
            f => f.id !== faction.id && faction.getRelation(f.id) > -20 && faction.getRelation(f.id) < 50
        );
        
        if (potentialAllies.length === 0) return null;
        
        return potentialAllies[Math.floor(Math.random() * potentialAllies.length)].id;
    }

    /**
     * Phase 3: Cancel pending events for a faction when strategy changes
     * @param {string} factionId 
     */
    cancelFactionPendingEvents(factionId) {
        if (!this.eventQueue) return;
        
        // Remove future events scheduled by this faction
        const eventsToKeep = [];
        let removed = 0;
        
        while (this.eventQueue._heap && this.eventQueue._heap.heap.length > 0) {
            const event = this.eventQueue.popEarliest();
            if (event && event.scheduledBy === factionId && event.executeAt > this.currentTimeMinutes) {
                removed++;
            } else if (event) {
                eventsToKeep.push(event);
            }
        }
        
        // Re-add kept events
        for (const event of eventsToKeep) {
            this.eventQueue.schedule(event);
        }
        
        // Also clean from any internal tracking arrays if they exist
        if (this.plannedEvents) {
            this.plannedEvents = this.plannedEvents.filter(e => e.scheduledBy !== factionId);
        }
    }

    // Legacy Phase 2 methods - kept for compatibility
    // These are now wrappers around Phase 3 implementations

    /**
     * Generate unique event ID
     * @returns {string}
     */
    _generateEventId() {
        return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get random number in range
     * @param {number} min 
     * @param {number} max 
     * @returns {number}
     */
    _randomRange(min, max) {
        return Math.floor(min + Math.random() * (max - min));
    }

    /**
     * Get locations controlled by a faction
     * @param {string} factionId 
     * @returns {Location[]}
     */
    _getControlledLocations(factionId) {
        return Array.from(this.locations.values()).filter(
            loc => loc.controllingFactionId === factionId
        );
    }

    /**
     * Get NPCs belonging to a faction
     * @param {string} factionId 
     * @returns {NPC[]}
     */
    _getFactionNPCs(factionId) {
        return Array.from(this.npcs.values()).filter(
            npc => npc.factionId === factionId
        );
    }

    /**
     * Find a faction that might rebel
     * @param {Faction} excludingFaction 
     * @returns {Faction|null}
     */
    _findRebelFaction(excludingFaction) {
        const candidates = Array.from(this.factions.values()).filter(
            f => f.id !== excludingFaction.id && f.power < 40
        );
        return candidates.length > 0 ? candidates[0] : null;
    }

    /**
     * Find weak neighbor to attack
     * @param {Faction} faction 
     * @returns {Faction|null}
     */
    _findWeakNeighbor(faction) {
        let weakest = null;
        let minPower = Infinity;

        for (const [id, other] of this.factions) {
            if (id === faction.id) continue;
            if (other.power < minPower && faction.getRelation(other.id) < 30) {
                minPower = other.power;
                weakest = other;
            }
        }

        return weakest;
    }

    /**
     * Find neutral location between factions
     * @param {Faction} attacker 
     * @param {Faction} defender 
     * @returns {Location|null}
     */
    _findNeutralLocation(attacker, defender) {
        const candidates = Array.from(this.locations.values()).filter(
            loc => loc.controllingFactionId !== attacker.id && 
                   loc.controllingFactionId !== defender.id &&
                   loc.controllingFactionId !== null
        );
        return candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
    }

    /**
     * Find potential allies for a faction
     * @param {Faction} faction 
     * @returns {Faction[]}
     */
    _findPotentialAllies(faction) {
        return Array.from(this.factions.values()).filter(
            f => f.id !== faction.id && faction.getRelation(f.id) > -20
        );
    }

    /**
     * Phase 3: Assign random long-term goals to a faction
     * Called during world initialization
     * @param {Faction} faction 
     */
    _assignRandomGoals(faction) {
        // Determine number of goals (1-3)
        const numGoals = 1 + Math.floor(Math.random() * 3);
        
        // Shuffle goal types and pick first numGoals
        const shuffledTypes = [...GOAL_TYPES].sort(() => Math.random() - 0.5);
        
        for (let i = 0; i < numGoals; i++) {
            const goalType = shuffledTypes[i];
            let target = null;
            let priority = 50 + Math.floor(Math.random() * 50); // 50-100
            
            // Assign specific targets based on goal type
            switch (goalType) {
                case "expand_territory":
                case "destroy_faction":
                    // Target a random other faction
                    const otherFactions = Array.from(this.factions.values()).filter(
                        f => f.id !== faction.id
                    );
                    if (otherFactions.length > 0) {
                        target = otherFactions[Math.floor(Math.random() * otherFactions.length)].id;
                    }
                    priority = 70 + Math.floor(Math.random() * 30); // Higher priority for aggressive goals
                    break;
                    
                case "alliance_formation":
                    // Target a faction to ally with
                    const potentialAllies = Array.from(this.factions.values()).filter(
                        f => f.id !== faction.id && faction.getRelation(f.id) > -30
                    );
                    if (potentialAllies.length > 0) {
                        target = potentialAllies[Math.floor(Math.random() * potentialAllies.length)].id;
                    }
                    break;
                    
                case "survival":
                    // No specific target - generic survival
                    priority = 80 + Math.floor(Math.random() * 20); // High priority
                    break;
                    
                default:
                    // Other goal types have no specific target
                    break;
            }
            
            const goal = new Goal(goalType, target, priority);
            faction.longTermGoals.push(goal);
        }
    }

    /**
     * Plan follow-up events after an event is resolved
     * @param {WorldEvent} event 
     */
    _planFollowUpEvents(event) {
        // For ongoing wars, schedule follow-up battles
        if (event.type === "war_battle") {
            const attacker = this.factions.get(event.data.attacker_faction_id);
            const defender = this.factions.get(event.data.defender_faction_id);

            if (attacker && defender && this._stillAtWar(attacker, defender)) {
                const nextBattle = new WorldEvent(
                    this._generateEventId(),
                    "war_battle",
                    this.currentTimeMinutes + this._randomRange(4320, 14400),
                    "regional",
                    {
                        attacker_faction_id: attacker.id,
                        defender_faction_id: defender.id,
                        location_id: event.data.location_id,
                        troop_ratio: attacker.power / Math.max(defender.power, 1)
                    },
                    100,
                    false,
                    "system",
                    0.5
                );
                this._safeSchedule(nextBattle);
            }
        }
    }

    /**
     * Check if two factions are still at war
     * @param {Faction} factionA 
     * @param {Faction} factionB 
     * @returns {boolean}
     */
    _stillAtWar(factionA, factionB) {
        return factionA.getRelation(factionB.id) <= -50;
    }

    /**
     * Append world changes to log
     * @param {WorldChange[]} changes 
     */
    _appendWorldChanges(changes) {
        for (const change of changes) {
            this.logWorldChange(change);
        }
    }

    /**
     * Safe schedule with throttling checks
     * @param {WorldEvent} event 
     * @returns {boolean} - true if scheduled, false if rejected
     */
    _safeSchedule(event) {
        const limits = this.config.eventLimits;

        // Check hard cap
        if (this.eventQueue.count() >= limits.MAX_QUEUED_EVENTS_HARD_CAP) {
            console.warn(`Event rejected: Queue hard cap reached (${this.eventQueue.count()})`);
            return false;
        }

        // Check active wars limit
        if (event.type === "war_declared") {
            const activeWars = this._countActiveWars();
            if (activeWars >= limits.MAX_ACTIVE_WARS) {
                console.warn(`Event rejected: Max active wars reached (${activeWars})`);
                return false;
            }
        }

        // Throttle battle events
        if (event.type.startsWith("war_")) {
            const recentBattles = this._countRecentBattles();
            if (recentBattles > limits.MAX_BATTLES_PER_MONTH) {
                // Weaken instead of reject
                if (event.data.strength) {
                    event.data.strength *= 0.6;
                }
            }
        }

        // Check per-faction limit
        if (event.scheduledBy) {
            // Simplified check - in production would track per-faction counts
        }

        this.eventQueue.schedule(event);
        return true;
    }

    /**
     * Count active wars
     * @returns {number}
     */
    _countActiveWars() {
        let count = 0;
        for (const defenders of this.activeWars.values()) {
            count += defenders.size;
        }
        return count;
    }

    /**
     * Count recent battles (simplified)
     * @returns {number}
     */
    _countRecentBattles() {
        // Simplified - count war_battle events in queue
        return this.eventQueue.countByType("war_battle");
    }

    // ========================================================================
    // WORLD MODIFICATION METHODS
    // ========================================================================

    /**
     * Add a location to the world
     */
    addLocation(location) {
        this.locations.set(location.id, location);
    }

    /**
     * Add a faction to the world
     */
    addFaction(faction) {
        this.factions.set(faction.id, faction);
    }

    /**
     * Add an NPC to the world
     */
    addNPC(npc) {
        this.npcs.set(npc.id, npc);
    }

    /**
     * Set the player
     */
    setPlayer(player) {
        this.player = player;
    }

    /**
     * Log a world change
     */
    logWorldChange(worldChange) {
        this.worldLog.push({
            timestamp: this.currentTimeMinutes,
            change: worldChange.toJSON()
        });
        if (this.worldLog.length > 1000) {
            this.worldLog = this.worldLog.slice(-1000);
        }
        if (!Array.isArray(this.rawChangeLog)) this.rawChangeLog = [];
        this.rawChangeLog.push(worldChange);
        if (this.rawChangeLog.length > 500) {
            this.rawChangeLog = this.rawChangeLog.slice(-500);
        }
    }

    /**
     * Get location by ID
     */
    getLocation(locationId) {
        return this.locations.get(locationId);
    }

    /**
     * Get NPC by ID
     */
    getNPC(npcId) {
        return this.npcs.get(npcId);
    }

    /**
     * Get faction by ID
     */
    getFaction(factionId) {
        return this.factions.get(factionId);
    }

    getScenarioPrompt(maxChars = 12000, options = {}) {
        const budget = Number.isSafeInteger(maxChars) && maxChars > 0 ? maxChars : 12000;
        if (!this.scenario) return ''.slice(0, budget);
        const state = this.scenarioState || newScenarioState(this.scenario);
        const scenario = scenarioSafeValue(this.scenario) || {};
        if (options && options.maskNpcNames && Array.isArray(scenario.npcs)) {
            scenario.npcs = scenario.npcs.map(npc => {
                if (!npc || typeof npc !== 'object') return npc;
                const { name, ...withoutName } = npc;
                return withoutName;
            });
        }
        const fields = ['id', 'title', 'pitch', 'tone', 'directorBrief', 'acts', 'mainArc', 'sideQuests', 'npcs', 'factions', 'choices', 'multiplayerHooks', 'endings', 'antiRailroadingRules'];
        const lines = ['SCENARIO'];
        for (const field of fields) {
            if (scenario[field] !== undefined) lines.push(`${field}: ${JSON.stringify(scenario[field])}`);
        }
        lines.push(`CURRENT_SCENARIO_STATE: ${JSON.stringify(state)}`);
        let prompt = lines.join('\n');
        if (options && options.maskNpcNames) {
            const scenarioNpcNames = Array.isArray(this.scenario.npcs)
                ? this.scenario.npcs.map(npc => typeof npc?.name === 'string' ? npc.name.trim() : '')
                : [];
            const worldNpcNames = this.npcs instanceof Map
                ? Array.from(this.npcs.values()).map(npc => typeof npc?.name === 'string' ? npc.name.trim() : '')
                : [];
            const canonicalNames = [...scenarioNpcNames, ...worldNpcNames]
                .filter(Boolean)
                .sort((a, b) => b.length - a.length);
            for (const name of canonicalNames) {
                prompt = prompt.split(name).join('Nieznana postać');
            }
        }
        return prompt.slice(0, budget);
    }

    recordScenarioChoice({ choiceId, optionId, flagsAdd = [], flagsRemove = [], variables = {}, note = '' } = {}) {
        const before = JSON.stringify(this.scenarioState);
        const choices = this.scenario && Array.isArray(this.scenario.choices) ? this.scenario.choices : [];
        const choice = choices.find(item => item && typeof item === 'object' && item.id === choiceId);
        const options = choice && Array.isArray(choice.options) ? choice.options : [];
        const option = options.find(item => item && typeof item === 'object' && item.id === optionId);
        if (!choice || !option) {
            return { success: false, reason: 'invalid_choice', choiceId: choiceId || null, optionId: optionId || null, state: scenarioSafeValue(this.scenarioState), changed: false };
        }

        const state = this.scenarioState || newScenarioState(this.scenario);
        const choiceKey = String(choiceId).slice(0, 120);
        const optionKey = String(optionId).slice(0, 120);
        if (state.choiceHistory.some(entry => entry && entry.choiceId === choiceKey && entry.optionId === optionKey)) {
            return { success: true, choiceId, optionId, state: scenarioSafeValue(state), changed: false, duplicate: true };
        }
        const optionFlagsAdd = Array.isArray(option.flagsAdd) ? option.flagsAdd : [];
        const optionFlagsRemove = Array.isArray(option.flagsRemove) ? option.flagsRemove : [];
        const add = [...optionFlagsAdd, ...(Array.isArray(flagsAdd) ? flagsAdd : [])]
            .filter(flag => typeof flag === 'string').map(flag => flag.slice(0, 120));
        const remove = [...optionFlagsRemove, ...(Array.isArray(flagsRemove) ? flagsRemove : [])]
            .filter(flag => typeof flag === 'string').map(flag => flag.slice(0, 120));
        state.flags = [...new Set(state.flags.concat(add))].filter(flag => !remove.includes(flag)).slice(0, 200);
        const optionVariables = option.variables && typeof option.variables === 'object' && !Array.isArray(option.variables) ? option.variables : {};
        const explicitVariables = variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {};
        const safeVariables = scenarioSafeValue({ ...optionVariables, ...explicitVariables }, 1) || {};
        if (Object.keys(safeVariables).length > 0) {
            state.variables = { ...state.variables, ...safeVariables };
        }
        const nextAct = option.nextAct || option.activeAct || choice.nextAct || choice.activeAct;
        if (typeof nextAct === 'string' && nextAct.trim()) state.activeAct = nextAct.trim().slice(0, 120);
        state.choiceHistory = state.choiceHistory.concat([{
            choiceId: choiceKey,
            optionId: optionKey,
            consequence: { flagsAdd: [...new Set(add)].slice(0, 32), flagsRemove: [...new Set(remove)].slice(0, 32), variables: safeVariables },
            note: (typeof note === 'string' && note.trim() ? note : option.note || '').slice(0, 240)
        }]).slice(-200);
        this.scenarioState = state;
        return { success: true, choiceId, optionId, state: scenarioSafeValue(state), changed: before !== JSON.stringify(state) };
    }

    // ========================================================================
    // SERIALIZATION
    // ========================================================================

    /**
     * Serialize world to JSON
     */
    toJSON() {
        return {
            currentTimeMinutes: this.currentTimeMinutes,
            locations: Array.from(this.locations.values()).map(l => l.toJSON()),
            factions: Array.from(this.factions.values()).map(f => f.toJSON()),
            npcs: Array.from(this.npcs.values()).map(n => n.toJSON()),
            player: this.player ? this.player.toJSON() : null,
            worldLog: this.worldLog,
            config: this.config,
            seed: this.seed,
            isSandbox: this.isSandbox === true,
            worldMetadata: this.worldMetadata,
            scenario: this.scenario,
            scenarioState: this.scenarioState,
            lastGlobalStrategicUpdate: this.lastGlobalStrategicUpdate,
            // Phase 2: Serialize event queue
            eventQueue: this.eventQueue ? this.eventQueue.toJSON() : null,
            activeWars: Array.from(this.activeWars.entries()).map(([k, v]) => [k, Array.from(v)]),
            // Phase 4: Contextual Memory System
            historyNodes: this.historyNodes.map(node => node.toJSON()),
            rawChangeLog: this.rawChangeLog.map(wc => wc.toJSON ? wc.toJSON() : wc),
            actionCountSinceLastCompression: this.actionCountSinceLastCompression,
            currentNpcMemory: Object.fromEntries(this.currentNpcMemory),
            narrativeMemory: this.narrativeMemory ? this.narrativeMemory.toJSON() : new NarrativeMemory().toJSON(),
            questDefinitions: this.questDefinitions,
            combatState: this.getCombatState()
        };
    }

    /**
     * Snapshot intended for a player client. Narrative secrets and facts that
     * this viewer does not know are intentionally excluded.
     */
    toViewerJSON(viewerId) {
        const snapshot = this.toJSON();
        snapshot.narrativeMemory = this.narrativeMemory
            ? this.narrativeMemory.toViewerJSON(viewerId)
            : new NarrativeMemory().toViewerJSON(viewerId);
        return snapshot;
    }

    /**
     * Deserialize world from JSON
     */
    static fromJSON(json) {
        if (!json || typeof json !== 'object') {
            throw new Error('Invalid world save: expected an object');
        }
        const world = new World();

        const savedTime = Number(json.currentTimeMinutes);
        world.currentTimeMinutes = Number.isSafeInteger(savedTime) && savedTime >= 0
            ? savedTime
            : 0;
        world.seed = json.seed;
        world.isSandbox = json.isSandbox === true;
        if (json.worldMetadata && typeof json.worldMetadata === 'object') {
            world.worldMetadata = {
                ...world.worldMetadata,
                name: typeof json.worldMetadata.name === 'string' ? json.worldMetadata.name : null,
                description: typeof json.worldMetadata.description === 'string' ? json.worldMetadata.description : null,
                plan: typeof json.worldMetadata.plan === 'string' ? json.worldMetadata.plan : null,
                scenario: normalizeScenarioDefinition(json.worldMetadata.scenario)
            };
        }
        world.scenario = normalizeScenarioDefinition(json.scenario || world.worldMetadata.scenario);
        world.worldMetadata.scenario = world.scenario;
        if (json.scenarioState && typeof json.scenarioState === 'object') {
            const restored = scenarioSafeValue(json.scenarioState) || {};
            world.scenarioState = {
                activeAct: typeof restored.activeAct === 'string' ? restored.activeAct.slice(0, 120) : null,
                flags: Array.isArray(restored.flags) ? [...new Set(restored.flags.filter(item => typeof item === 'string').slice(0, 200))] : [],
                choiceHistory: Array.isArray(restored.choiceHistory) ? restored.choiceHistory.slice(0, 200) : [],
                variables: restored.variables && typeof restored.variables === 'object' && !Array.isArray(restored.variables) ? restored.variables : {}
            };
        } else {
            world.scenarioState = newScenarioState(world.scenario);
        }
        world.lastGlobalStrategicUpdate = Number.isSafeInteger(json.lastGlobalStrategicUpdate)
            ? json.lastGlobalStrategicUpdate
            : 0;
        
        // Restore locations
        if (json.locations) {
            for (const locData of json.locations) {
                world.locations.set(locData.id, Location.fromJSON(locData));
            }
        }
        
        // Restore factions
        if (json.factions) {
            for (const factionData of json.factions) {
                world.factions.set(factionData.id, Faction.fromJSON(factionData));
            }
        }
        
        // Restore NPCs
        if (json.npcs) {
            for (const npcData of json.npcs) {
                world.npcs.set(npcData.id, NPC.fromJSON(npcData));
            }
        }
        
        // Restore player
        if (json.player) {
            world.player = Player.fromJSON(json.player);
        }
        
        // Restore config
        if (json.config) {
            world.config = {
                ...world.config,
                ...json.config,
                regenRates: { ...world.config.regenRates, ...(json.config.regenRates || {}) },
                consumptionRates: { ...world.config.consumptionRates, ...(json.config.consumptionRates || {}) },
                statusThresholds: { ...world.config.statusThresholds, ...(json.config.statusThresholds || {}) },
                eventLimits: { ...world.config.eventLimits, ...(json.config.eventLimits || {}) }
            };
        }
        
        // Restore world log
        world.worldLog = json.worldLog || [];
        
        // Phase 2: Restore event queue
        if (json.eventQueue) {
            world.eventQueue = EventQueue.fromJSON(json.eventQueue);
        }
        
        // Phase 2: Restore active wars
        if (json.activeWars) {
            // FIX: Handle both array of entries and plain object
            if (Array.isArray(json.activeWars)) {
                world.activeWars = new Map(json.activeWars.map(([k, v]) => [k, new Set(v)]));
            } else if (typeof json.activeWars === 'object') {
                world.activeWars = new Map(Object.entries(json.activeWars).map(([k, v]) => [k, new Set(Array.isArray(v) ? v : [])]));
            }
        }
        
        // Phase 4: Contextual Memory System
        if (json.historyNodes) {
            world.historyNodes = json.historyNodes.map(nodeData => HistoryNode.fromJSON(nodeData));
        }
        if (json.rawChangeLog) {
            world.rawChangeLog = json.rawChangeLog.map(wc => 
                wc instanceof WorldChange ? wc : WorldChange.fromJSON(wc)
            );
        }
        world.actionCountSinceLastCompression = json.actionCountSinceLastCompression || 0;
        if (json.currentNpcMemory) {
            world.currentNpcMemory = new Map(Object.entries(json.currentNpcMemory));
        }
        // Saves made before NarrativeMemory V1 keep loading. Legacy history
        // summaries become episodes, while no old prose is guessed into facts.
        world.narrativeMemory = json.narrativeMemory
            ? NarrativeMemory.fromJSON(json.narrativeMemory)
            : NarrativeMemory.migrateLegacy(world.historyNodes);
        world.memoryStatus = json.memoryStatus && typeof json.memoryStatus === 'object'
            ? { ...json.memoryStatus }
            : null;
        world.questDefinitions = Array.isArray(json.questDefinitions) ? json.questDefinitions : [];
        if (json.combatState && typeof json.combatState === 'object') {
            const combat = scenarioSafeValue(json.combatState) || null;
            if (combat && ['active', 'completed'].includes(combat.status)) {
                combat.participants = Array.isArray(combat.participants) ? combat.participants.slice(0, 16) : [];
                combat.log = Array.isArray(combat.log) ? combat.log.slice(-40) : [];
                world.combatState = combat;
            }
        }
        
        return world;
    }

    // ========================================================================
    // PHASE 4: CONTEXTUAL MEMORY SYSTEM - LIVE STATE
    // ========================================================================

    /**
     * Phase 4: Get Live State - current snapshot of world for LLM context
     * Target: ~800-1500 tokens
     * @returns {Object} Live State data structure
     */
    getLiveState() {
        return {
            currentTime: {
                day: this.getDayNumber(),
                time: this.getFormattedTime(),
                period: this.getTimeOfDay(),
                totalMinutes: this.currentTimeMinutes
            },
            player: this._getPlayerLiveState(),
            location: this._getCurrentLocationLiveState(),
            activeWars: this.getActiveWarsSummary(),
            topReputations: this.getTopPlayerReputations(),
            recentMajorEvents: this.getRecentMajorChanges(),
            npcInteractions: this._getRecentNpcInteractions()
        };
    }

    /**
     * Get player info for Live State
     * @returns {Object}
     */
    _getPlayerLiveState() {
        if (!this.player) return null;
        
        return {
            name: this.player.name,
            locationId: this.player.locationId,
            hp: this.player.hp,
            maxHp: this.player.maxHp,
            gold: this.player.gold,
            hunger: this.player.hunger,
            thirst: this.player.thirst,
            fatigue: this.player.fatigue,
            statusEffects: this.player.statusEffects.map(e => e.name)
        };
    }

    /**
     * Get current location info for Live State
     * @returns {Object}
     */
    _getCurrentLocationLiveState() {
        if (!this.player) return null;
        
        const location = this.locations.get(this.player.locationId);
        if (!location) return null;
        
        return {
            id: location.id,
            name: location.name,
            controllingFaction: location.controllingFactionId,
            population: location.population,
            wealth: location.wealth,
            stability: location.stability,
            dangerLevel: location.dangerLevel
        };
    }

    /**
     * Phase 4: Get summary of active wars
     * @returns {Array}
     */
    getActiveWarsSummary() {
        const wars = [];
        const maxWars = MEMORY_CONFIG.MAX_WARS_IN_CONTEXT;
        
        for (const [attackerId, defenders] of this.activeWars) {
            const attacker = this.factions.get(attackerId);
            if (!attacker) continue;
            
            for (const defenderId of defenders) {
                const defender = this.factions.get(defenderId);
                if (!defender) continue;
                
                wars.push({
                    attacker: attacker.name,
                    defender: defender.name,
                    attackerPower: attacker.power,
                    defenderPower: defender.power
                });
                
                if (wars.length >= maxWars) break;
            }
            if (wars.length >= maxWars) break;
        }
        
        return wars;
    }

    /**
     * Phase 4: Get player's top faction reputations
     * @returns {Array}
     */
    getTopPlayerReputations() {
        if (!this.player) return [];
        
        const reputations = [];
        const maxReps = MEMORY_CONFIG.MAX_REPUTATIONS_IN_CONTEXT;
        
        // Convert Map to array and sort by absolute value
        const repArray = Array.from(this.player.reputation.entries())
            .map(([factionId, value]) => {
                const faction = this.factions.get(factionId);
                return {
                    factionId,
                    factionName: faction ? faction.name : factionId,
                    value
                };
            })
            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
        
        return repArray.slice(0, maxReps);
    }

    /**
     * Phase 4: Get recent major world changes
     * @returns {Array}
     */
    getRecentMajorChanges() {
        const changes = [];
        const maxEvents = MEMORY_CONFIG.MAX_MAJOR_EVENTS_IN_CONTEXT;
        const threshold = MEMORY_CONFIG.IMPORTANCE_THRESHOLD;
        
        // Check rawChangeLog first
        for (let i = this.rawChangeLog.length - 1; i >= 0; i--) {
            const change = this.rawChangeLog[i];
            const importance = change.staticImportance || 0;
            
            if (importance >= threshold) {
                changes.push({
                    type: change.type,
                    description: change.description,
                    scope: change.scope,
                    importance
                });
            }
            
            if (changes.length >= maxEvents) break;
        }
        
        // Also check worldLog
        for (const logEntry of this.worldLog) {
            if (changes.length >= maxEvents) break;
            
            const change = logEntry.change || logEntry;
            const importance = change.staticImportance || IMPORTANCE_TABLE[change.type] || 0;
            
            if (importance >= threshold) {
                // Avoid duplicates
                const exists = changes.some(c => c.description === change.description);
                if (!exists) {
                    changes.push({
                        type: change.type,
                        description: change.description,
                        scope: change.scope,
                        importance
                    });
                }
            }
        }
        
        return changes;
    }

    /**
     * Get recent NPC interactions for current location
     * @returns {Array}
     */
    _getRecentNpcInteractions() {
        if (!this.player) return [];
        
        const locationNpcs = Array.from(this.npcs.values())
            .filter(npc => npc.locationId === this.player.locationId && npc.isAlive !== false)
            .slice(0, 5);
        
        const unknownOrdinals = new Map();
        return locationNpcs.map(npc => {
            const isKnown = this.player.knowsNpcName?.(npc.id) || this.player.knownNpcIds?.has(npc.id);
            const previous = unknownOrdinals.get(npc.locationId) || 0;
            unknownOrdinals.set(npc.locationId, previous + 1);
            return {
                id: npc.id,
                name: isKnown && npc.name ? npc.name : `Nieznana postać${previous > 0 ? ` #${previous + 1}` : ''}`,
                factionId: npc.factionId,
                trust: npc.trust,
                respect: npc.respect
            };
        });
    }

    /**
     * Small, non-sensitive status object for the UI and multiplayer saves.
     * It exposes counts only; narrative facts and hidden director material
     * still go through the normal viewer filter.
     */
    getNarrativeMemoryStatus() {
        const memory = this.narrativeMemory || new NarrativeMemory();
        const turns = Array.isArray(memory.turns) ? memory.turns : [];
        const consolidated = turns.filter(turn => turn && turn.consolidated === true).length;
        return {
            revision: Number.isSafeInteger(memory.revision) ? memory.revision : 0,
            completedTurns: turns.length,
            consolidatedTurns: consolidated,
            pendingTurns: Math.max(0, turns.length - consolidated),
            facts: memory.facts instanceof Map ? memory.facts.size : 0,
            episodes: Array.isArray(memory.episodes) ? memory.episodes.length : 0,
            threads: memory.threads instanceof Map ? memory.threads.size : 0,
            nextConsolidationAt: NARRATIVE_MEMORY_CONSOLIDATION_TURNS
        };
    }

    /**
     * Mark an NPC's real name as known only when the player asked for it and
     * the narrator actually used that name in the answer.
     * @returns {string[]} IDs of NPCs whose names became known
     */
    revealNpcNamesFromDialogue(action, response, player = this.player) {
        if (!player || typeof action !== 'string' || typeof response !== 'string') return [];
        const normalize = value => String(value || '')
            .toLocaleLowerCase('pl-PL')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        const actionText = normalize(action);
        const responseText = normalize(response);
        const asksForName = /\b(imie|nazywasz|nazywam|przedstaw|kim jestes|kto ty|twoje imie)\b/i.test(actionText);
        if (!asksForName) return [];

        const claimedNameToken = responseText.match(/\b(?:nazywam sie|mam na imie|jestem)\s+([a-z-]+)/i)?.[1] || '';
        const revealed = [];
        for (const npc of this.npcs.values()) {
            if (npc.locationId !== player.locationId || npc.isAlive === false || !npc.name) continue;
            const normalizedName = normalize(npc.name).trim();
            const nameTokens = normalizedName.split(/\s+/).filter(Boolean);
            const exactMention = responseText.includes(normalizedName);
            const statedToken = claimedNameToken && nameTokens.includes(claimedNameToken);
            if ((exactMention || statedToken) && player.revealNpcName(npc.id)) revealed.push(npc.id);
        }
        return revealed;
    }

    /**
     * Find NPC names that a player who already knows them is explicitly
     * mentioning in a player-to-player message.
     */
    getKnownNpcIdsMentionedInText(text, player = this.player) {
        if (!player || typeof text !== 'string') return [];
        const normalize = value => String(value || '')
            .toLocaleLowerCase('pl-PL')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        const words = normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
        const knownNpcs = Array.from(this.npcs.values()).filter(npc => {
            return npc?.name && (player.knowsNpcName?.(npc.id) || player.knownNpcIds?.has(npc.id));
        });
        const mentioned = [];
        for (const npc of knownNpcs) {
            const nameWords = normalize(npc.name).split(/[^a-z0-9]+/).filter(Boolean);
            if (nameWords.length === 0) continue;
            const fullNameMentioned = nameWords.every((word, index) => words[index] === word)
                || words.some((_, start) => nameWords.every((word, offset) => words[start + offset] === word));
            const uniqueFirstNameMentioned = nameWords.length > 1
                && words.includes(nameWords[0])
                && knownNpcs.filter(candidate => normalize(candidate.name).split(/[^a-z0-9]+/).filter(Boolean)[0] === nameWords[0]).length === 1;
            if (fullNameMentioned || uniqueFirstNameMentioned) mentioned.push(npc.id);
        }
        return mentioned;
    }

    // ========================================================================
    // PHASE 4: CONTEXTUAL MEMORY SYSTEM - COMPRESSION
    // ========================================================================

    /**
     * Phase 4: Compress history if needed
     * Called after player actions
     */
    compressHistoryIfNeeded() {
        this.actionCountSinceLastCompression++;
        
        if (this.actionCountSinceLastCompression >= MEMORY_CONFIG.COMPRESSION_INTERVAL) {
            this._performCompression();
            this.actionCountSinceLastCompression = 0;
        }
    }

    /**
     * Phase 4: Perform history compression
     * Creates a new HistoryNode from recent changes
     */
    _performCompression() {
        // Gather changes since last compression
        const recentChanges = [...this.rawChangeLog];
        
        if (recentChanges.length === 0) return;
        
        // Calculate static importance from changes
        let totalImportance = 0;
        const tags = new Set();
        
        for (const change of recentChanges) {
            totalImportance += change.staticImportance || 0;
            
            // Infer tags from change type
            if (change.type.includes("war") || change.type.includes("battle")) {
                tags.add("combat");
                tags.add("political");
            } else if (change.type.includes("reputation")) {
                tags.add("social");
            } else if (change.type.includes("economic") || change.type.includes("trade")) {
                tags.add("economic");
            } else if (change.type.includes("move") || change.type.includes("travel")) {
                tags.add("exploration");
            }
        }
        
        // Average importance
        const avgImportance = recentChanges.length > 0 
            ? totalImportance / recentChanges.length 
            : 0;
        
        // Determine time range
        const timeStart = recentChanges[0].timestamp || (this.currentTimeMinutes - MEMORY_CONFIG.COMPRESSION_INTERVAL * 10);
        const timeEnd = this.currentTimeMinutes;
        
        // Generate summary text (placeholder - would be LLM-generated in production)
        const summaryText = this._generateCompressionSummary(recentChanges);
        
        // Create new history node
        const node = new HistoryNode();
        node.timeStartMinutes = timeStart;
        node.timeEndMinutes = timeEnd;
        node.staticImportance = avgImportance;
        node.tags = tags;
        node.summaryText = summaryText;
        node.level = 1;
        
        // Set parent if exists
        if (this.historyNodes.length > 0) {
            node.parentId = this.historyNodes[this.historyNodes.length - 1].nodeId;
        }
        
        // Add to history
        this.historyNodes.push(node);
        
        // Clear raw change log (or keep last portion)
        const keepCount = MEMORY_CONFIG.COMPRESSION_INTERVAL * 2;
        this.rawChangeLog = this.rawChangeLog.slice(-keepCount);
    }

    /**
     * Phase 4: Generate summary text for compression
     * In production, this would use LLM
     * @param {Array} changes 
     * @returns {string}
     */
    _generateCompressionSummary(changes) {
        // Simple placeholder summary
        const changeTypes = {};
        for (const change of changes) {
            changeTypes[change.type] = (changeTypes[change.type] || 0) + 1;
        }
        
        const typeSummary = Object.entries(changeTypes)
            .map(([type, count]) => `${count}x ${type}`)
            .join(", ");
        
        return `Period summary: ${changes.length} changes occurred. ${typeSummary}`;
    }

    /**
     * Phase 4: Build compression prompt for LLM
     * @returns {string}
     */
    buildCompressionPrompt() {
        const recentChanges = this.rawChangeLog.slice(-MEMORY_CONFIG.COMPRESSION_INTERVAL * 2);
        
        let prompt = "Compress the following world changes into a concise narrative summary (80-300 tokens):\n\n";
        
        for (const change of recentChanges) {
            prompt += `- ${change.description}\n`;
        }
        
        prompt += "\nProvide a single paragraph summary that captures the key events and their significance.";
        
        return prompt;
    }

    // ========================================================================
    // PHASE 4: CONTEXTUAL MEMORY SYSTEM - CONTEXT BUILDING
    // ========================================================================

    /**
     * Phase 4: Build context for a specific scene
     * Combines Live State + relevant HistoryNodes
     * @param {string} sceneType - Type of scene (dialog, combat, exploration, etc.)
     * @param {Array} sceneTags - Tags describing the scene
     * @returns {Object} Context object with liveState and historyNodes
     */
    buildContextForScene(sceneType, sceneTags = []) {
        // Get Live State
        const liveState = this.getLiveState();
        
        // Score and select relevant history nodes
        const relevantNodes = this._selectRelevantNodes(sceneType, sceneTags);
        
        return {
            liveState,
            historyNodes: relevantNodes,
            metadata: {
                sceneType,
                sceneTags,
                nodeCount: relevantNodes.length,
                totalTokens: this._estimateContextTokens(liveState, relevantNodes)
            }
        };
    }

    /**
     * Phase 4: Select relevant history nodes for scene
     * @param {string} sceneType 
     * @param {Array} sceneTags 
     * @returns {Array}
     */
    _selectRelevantNodes(sceneType, sceneTags) {
        const scoredNodes = [];
        
        for (const node of this.historyNodes) {
            const score = this.scoreNodeForScene(node, sceneType, sceneTags);
            if (score >= MEMORY_CONFIG.MIN_NODE_RELEVANCE) {
                scoredNodes.push({ node, score });
            }
        }
        
        // Sort by score descending
        scoredNodes.sort((a, b) => b.score - a.score);
        
        // Take top N nodes
        const maxNodes = MEMORY_CONFIG.MAX_NODES_PER_CONTEXT;
        return scoredNodes.slice(0, maxNodes).map(sn => sn.node);
    }

    /**
     * Phase 4: Score a history node for relevance to current scene
     * @param {HistoryNode} node 
     * @param {string} sceneType 
     * @param {Array} sceneTags 
     * @returns {number} Relevance score 0-1
     */
    scoreNodeForScene(node, sceneType, sceneTags) {
        let score = 0;
        
        // Base: final importance (already calculated)
        score += node.finalImportance * 0.4;
        
        // Tag matching
        if (sceneTags.length > 0 && node.tags.size > 0) {
            const matchingTags = sceneTags.filter(tag => node.tags.has(tag));
            const tagScore = matchingTags.length / sceneTags.length;
            score += tagScore * 0.3;
        }
        
        // Recency bonus
        const daysSince = (this.currentTimeMinutes - node.timeEndMinutes) / 1440;
        if (daysSince < 7) {
            score += 0.2;
        } else if (daysSince < 30) {
            score += 0.1;
        }
        
        // Player involvement bonus
        if (node.causedBy.includes("player") || node.summaryText.toLowerCase().includes(this.player?.name?.toLowerCase() || "")) {
            score += 0.1;
        }
        
        return Math.min(1.0, score);
    }

    /**
     * Phase 4: Estimate token count for context
     * @param {Object} liveState 
     * @param {Array} historyNodes 
     * @returns {number} Estimated tokens
     */
    _estimateContextTokens(liveState, historyNodes) {
        // Rough estimation: ~4 characters per token
        const liveStateStr = JSON.stringify(liveState);
        const liveStateTokens = liveStateStr.length / 4;
        
        let historyTokens = 0;
        for (const node of historyNodes) {
            historyTokens += node.summaryText.length / 4;
        }
        
        return Math.round(liveStateTokens + historyTokens);
    }

    /**
     * Record one completed player/narrator exchange in the structured
     * narrative layer. The caller should invoke this only after a narrator
     * response exists; it has no mechanical side effects.
     */
    recordNarrativeTurn(turn = {}) {
        if (!this.narrativeMemory) this.narrativeMemory = new NarrativeMemory();
        return this.narrativeMemory.recordTurn({
            ...turn,
            gameTime: Number.isFinite(Number(turn.gameTime)) ? Number(turn.gameTime) : this.currentTimeMinutes
        });
    }

    /**
     * Return relevance-selected narrative facts for an LLM prompt or UI. By
     * default it is viewer-safe; pass includeDirectorSecrets only in trusted
     * server/local narrator code.
     */
    buildNarrativeContext(query = {}) {
        if (!this.narrativeMemory) this.narrativeMemory = new NarrativeMemory();
        return this.narrativeMemory.buildContext({
            ...query,
            locationId: query.locationId || this.player?.locationId || null
        });
    }

    buildMemoryConsolidationInput() {
        if (!this.narrativeMemory) this.narrativeMemory = new NarrativeMemory();
        return this.narrativeMemory.buildConsolidationInput();
    }

    applyNarrativeMemoryPatch(patch) {
        if (!this.narrativeMemory) this.narrativeMemory = new NarrativeMemory();
        return this.narrativeMemory.applyPatch(patch);
    }

    /**
     * Phase 4: Record a player action for memory system
     * @param {string} actionType - Type of action
     * @param {Object} actionData - Action details
     */
    recordPlayerAction(actionType, actionData = {}) {
        // Add to raw change log
        const change = new WorldChange(
            actionType,
            actionData.targetId || null,
            actionData.delta || null,
            actionData.description || `Player performed ${actionType}`,
            actionData.scope || "local"
        );
        
        this.rawChangeLog.push(change);
        
        // Check for compression
        this.compressHistoryIfNeeded();
    }

    /**
     * Phase 4: Update NPC memory for interaction tracking
     * @param {string} npcId 
     * @param {Object} interaction 
     */
    updateNpcMemory(npcId, interaction) {
        if (!this.currentNpcMemory.has(npcId)) {
            this.currentNpcMemory.set(npcId, []);
        }
        
        const memory = this.currentNpcMemory.get(npcId);
        memory.push({
            timestamp: this.currentTimeMinutes,
            type: interaction.type,
            summary: interaction.summary
        });
        
        // Keep only recent interactions
        const maxDepth = MEMORY_CONFIG.NPC_MEMORY_DEPTH;
        while (memory.length > maxDepth) {
            memory.shift();
        }
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    /**
     * Get formatted time string (e.g., "12:30")
     */
    getFormattedTime() {
        const hours = Math.floor(this.currentTimeMinutes / 60);
        const minutes = this.currentTimeMinutes % 60;
        return `${hours}:${minutes.toString().padStart(2, '0')}`;
    }

    /**
     * Get time description (e.g., "Morning", "Afternoon", "Night")
     */
    getTimeOfDay() {
        const hour = this.currentTimeMinutes % (24 * 60) / 60;
        
        if (hour >= 6 && hour < 12) return "Morning";
        if (hour >= 12 && hour < 17) return "Afternoon";
        if (hour >= 17 && hour < 21) return "Evening";
        return "Night";
    }

    /**
     * Get day number (1-based)
     */
    getDayNumber() {
        return Math.floor(this.currentTimeMinutes / (24 * 60)) + 1;
    }

    static validateBlueprint(blueprint) {
        if (!blueprint || typeof blueprint !== 'object') throw new Error('World blueprint must be an object');
        const source = blueprint.world && typeof blueprint.world === 'object' ? blueprint.world : blueprint;
        const clamp = (value, min, max, fallback) => {
            const number = Number(value);
            return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
        };
        const makeId = (value, fallback) => String(value || fallback)
            .trim().toLocaleLowerCase('en-US').normalize('NFKD')
            .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 64) || fallback;
        const uniqueId = (value, fallback, used) => {
            const base = makeId(value, fallback);
            let id = base;
            let counter = 2;
            while (used.has(id)) id = `${base}_${counter++}`;
            used.add(id);
            return id;
        };
        const rawLocations = Array.isArray(source.locations) ? source.locations : (Array.isArray(blueprint.locations) ? blueprint.locations : []);
        if (rawLocations.length === 0) throw new Error('World blueprint needs at least one location');
        const locationIds = new Set();
        const locations = rawLocations.slice(0, 100).map((entry, index) => ({
            id: uniqueId(entry?.id || entry?.name, `location_${index + 1}`, locationIds),
            name: String(entry?.name || entry?.id || `Location ${index + 1}`).slice(0, 120),
            description: String(entry?.description || '').slice(0, 2000),
            population: Math.floor(clamp(entry?.population, 0, 100000000, 0)),
            wealth: clamp(entry?.wealth, 0, 100, 50),
            stability: clamp(entry?.stability, 0, 100, 50),
            dangerLevel: clamp(entry?.dangerLevel ?? entry?.danger, 0, 100, 0),
            controllingFactionId: entry?.controllingFactionId ? makeId(entry.controllingFactionId, '') : null,
            connections: Array.isArray(entry?.connections) ? entry.connections.map(id => makeId(id, '')).filter(Boolean) : []
        }));
        const validLocationIds = new Set(locations.map(location => location.id));
        locations.forEach(location => {
            location.connections = location.connections.filter(id => validLocationIds.has(id) && id !== location.id);
        });

        const factionIds = new Set();
        const factions = (Array.isArray(source.factions) ? source.factions : (Array.isArray(blueprint.factions) ? blueprint.factions : [])).slice(0, 50).map((entry, index) => {
            const id = uniqueId(entry?.id || entry?.name, `faction_${index + 1}`, factionIds);
            const rawRelations = entry?.relations && typeof entry.relations === 'object' ? entry.relations : {};
            const relations = Object.fromEntries(Object.entries(rawRelations).map(([key, value]) => [makeId(key, key), clamp(value, -100, 100, 0)]));
            return {
                id,
                name: String(entry?.name || id).slice(0, 120),
                description: String(entry?.description || entry?.goal || '').slice(0, 2000),
                power: clamp(entry?.power, 0, 100, 50),
                resources: clamp(entry?.resources, 0, 100, 50),
                aggression: clamp(entry?.aggression, 0, 100, 50),
                stability: clamp(entry?.stability, 0, 100, 50),
                relations
            };
        });

        const npcIds = new Set();
        const npcs = (Array.isArray(source.npcs) ? source.npcs : Array.isArray(blueprint.npcs) ? blueprint.npcs : Array.isArray(source.characters) ? source.characters : [])
            .slice(0, 200).map((entry, index) => {
                const id = uniqueId(entry?.id || entry?.name, `npc_${index + 1}`, npcIds);
                const locationId = validLocationIds.has(makeId(entry?.locationId, '')) ? makeId(entry.locationId, '') : locations[0].id;
                const inventory = Array.isArray(entry?.inventory) ? entry.inventory
                    .filter(item => item && ITEM_CATALOG[item.id] && Number.isInteger(item.quantity) && item.quantity > 0)
                    .map(item => ({ id: item.id, quantity: Math.min(1000, item.quantity) })) : [];
                const isMerchant = entry?.isMerchant === true || /merchant|kupiec|trader/i.test(String(entry?.role || ''));
                return {
                    id,
                    name: String(entry?.name || id).slice(0, 120),
                    description: String(entry?.description || '').slice(0, 2000),
                    role: String(entry?.role || '').slice(0, 80),
                    locationId,
                    factionId: entry?.factionId ? makeId(entry.factionId, '') : null,
                    hp: clamp(entry?.hp ?? entry?.maxHp, 1, 10000, 50),
                    maxHp: clamp(entry?.maxHp ?? entry?.hp, 1, 10000, 50),
                    attack: clamp(entry?.attack, 0, 500, 5),
                    defense: clamp(entry?.defense, 0, 500, 0),
                    armorClass: Math.floor(clamp(entry?.armorClass, 1, 40, 10 + clamp(entry?.defense, 0, 500, 0))),
                    damageDice: normalizeDiceNotation(entry?.damageDice, '1d6'),
                    goldReward: Math.floor(clamp(entry?.goldReward, 0, 100000, 0)),
                    xpReward: Math.floor(clamp(entry?.xpReward, 0, 100000, 10)),
                    isMerchant,
                    isQuestGiver: entry?.isQuestGiver === true || /quest|zadanie|warden|elder|gospodarz/i.test(String(entry?.role || '')),
                    gold: Math.floor(clamp(entry?.gold, 0, 1000000, isMerchant ? 500 : 0)),
                    inventory,
                    loot: Array.isArray(entry?.loot) ? entry.loot
                        .filter(item => item && ITEM_CATALOG[item.id] && Number.isInteger(item.quantity) && item.quantity > 0)
                        .map(item => ({ id: item.id, quantity: Math.min(1000, item.quantity) })) : []
                };
            });

        const questIds = new Set();
        const rawQuestDefinitions = Array.isArray(source.questDefinitions) ? source.questDefinitions
            : Array.isArray(blueprint.questDefinitions) ? blueprint.questDefinitions
            : Array.isArray(source.quests) ? source.quests
            : Array.isArray(blueprint.quests) ? blueprint.quests : [];
        const quests = rawQuestDefinitions.slice(0, 100).map((entry, index) => ({
            id: uniqueId(entry?.id || entry?.title, `quest_${index + 1}`, questIds),
            title: String(entry?.title || entry?.name || `Quest ${index + 1}`).slice(0, 160),
            description: String(entry?.description || '').slice(0, 2000),
            objective: entry?.objective && typeof entry.objective === 'object' ? {
                type: String(entry.objective.type || 'explore').toLocaleLowerCase('en-US'),
                targetId: entry.objective.targetId ? makeId(entry.objective.targetId, '') : null,
                required: Math.max(1, Math.floor(clamp(entry.objective.required, 1, 1000, 1)))
            } : { type: 'explore', targetId: null, required: 1 },
            reward: {
                gold: Math.floor(clamp(entry?.reward?.gold, 0, 100000, 0)),
                xp: Math.floor(clamp(entry?.reward?.xp, 0, 100000, 0))
            },
            ...(entry?.giverId ? { giverId: makeId(entry.giverId, '') } : {}),
            ...(entry?.giverLocationId ? { giverLocationId: makeId(entry.giverLocationId, '') } : {})
        }));

        return {
            version: 1,
            world: {
                name: String(source.name || blueprint.name || 'Generated World').slice(0, 160),
                description: String(source.description || blueprint.description || '').slice(0, 3000)
            },
            startLocationId: validLocationIds.has(makeId(source.startLocationId || blueprint.startLocationId, '')) ? makeId(source.startLocationId || blueprint.startLocationId, '') : locations[0].id,
            locations,
            factions,
            npcs,
            quests,
            questDefinitions: quests,
            scenario: normalizeScenarioDefinition(blueprint.scenario)
        };
    }

    static createFromBlueprint(blueprint, playerName, playerLocationId = null) {
        const data = World.validateBlueprint(blueprint);
        const world = new World();
        world.worldMetadata = {
            name: data.world.name,
            description: data.world.description,
            plan: JSON.stringify(data, null, 2),
            scenario: data.scenario
        };
        world.scenario = data.scenario;
        world.scenarioState = newScenarioState(world.scenario);
        for (const entry of data.locations) {
            const location = new Location(entry.id, entry.name);
            Object.assign(location, entry);
            world.addLocation(location);
        }
        for (const entry of data.factions) {
            const faction = new Faction(entry.id, entry.name);
            faction.description = entry.description;
            faction.power = entry.power;
            faction.resources = entry.resources;
            faction.aggression = entry.aggression;
            faction.stability = entry.stability;
            for (const [factionId, relation] of Object.entries(entry.relations || {})) faction.setRelation(factionId, relation);
            world.addFaction(faction);
        }
        for (const entry of data.npcs) {
            const npc = new NPC(entry.id, entry.locationId, entry.factionId);
            Object.assign(npc, entry);
            world.addNPC(npc);
        }
        world.questDefinitions = data.quests;
        const startId = playerLocationId && world.locations.has(playerLocationId)
            ? playerLocationId
            : data.startLocationId;
        const player = new Player(playerName, startId);
        player.addItem('bread', 2);
        player.addItem('healing_potion', 1);
        for (const faction of world.factions.values()) player.setReputation(faction.id, 0);
        world.setPlayer(player);
        return world;
    }

    /**
     * Create a true open-world sandbox. Locations are discovered from player
     * travel commands instead of being authored in a blueprint.
     */
    static createSandboxWorld(playerName) {
        const world = new World();
        world.isSandbox = true;
        world.worldMetadata = {
            name: 'Sandbox — pełna swoboda',
            description: 'Świat bez gotowej mapy, scenariusza i narzuconych lokacji. Miejsca powstają podczas gry.',
            plan: null,
            scenario: null
        };

        const start = new Location('sandbox_start', 'Punkt wyjścia');
        start.description = 'Neutralny punkt rozpoczęcia podróży. Poza nim świat nie ma jeszcze ustalonej mapy.';
        start.dangerLevel = 10;
        world.addLocation(start);

        const player = new Player(playerName, start.id);
        player.addItem('bread', 2);
        player.addItem('healing_potion', 1);
        world.setPlayer(player);
        return world;
    }

    /**
     * Create a simple starter world with default locations
     */
    static createStarterWorld(playerName, playerLocationId = "town_central") {
        const world = new World();
        
        // Create default locations
        const locations = [
            { id: "town_central", name: "Central Town", population: 500, wealth: 60, stability: 70, dangerLevel: 10, connections: ["tavern_golden_dragon", "market_square", "city_gate_north"] },
            { id: "tavern_golden_dragon", name: "Golden Dragon Tavern", population: 50, wealth: 40, stability: 60, dangerLevel: 5, connections: ["town_central"] },
            { id: "market_square", name: "Market Square", population: 200, wealth: 80, stability: 75, dangerLevel: 15, connections: ["town_central"] },
            { id: "city_gate_north", name: "North City Gate", population: 100, wealth: 30, stability: 50, dangerLevel: 25, connections: ["town_central", "forest_entrance"] },
            { id: "forest_entrance", name: "Forest Entrance", population: 0, wealth: 10, stability: 40, dangerLevel: 40, connections: ["city_gate_north", "dungeon_entrance"] },
            { id: "dungeon_entrance", name: "Ancient Ruins", population: 0, wealth: 20, stability: 30, dangerLevel: 60, connections: ["forest_entrance"] }
        ];
        
        for (const locData of locations) {
            const loc = new Location(locData.id, locData.name);
            loc.population = locData.population;
            loc.wealth = locData.wealth;
            loc.stability = locData.stability;
            loc.dangerLevel = locData.dangerLevel;
            loc.connections = locData.connections;
            world.addLocation(loc);
        }
        
        // Create default factions
        const factions = [
            { id: "kingdom", name: "Kingdom of Valdoria", power: 80, resources: 70, aggression: 30 },
            { id: "merchants_guild", name: "Merchants Guild", power: 50, resources: 90, aggression: 10 },
            { id: "thieves_guild", name: "Shadow Brotherhood", power: 30, resources: 50, aggression: 80 }
        ];
        
        for (const factData of factions) {
            const faction = new Faction(factData.id, factData.name);
            faction.power = factData.power;
            faction.resources = factData.resources;
            faction.aggression = factData.aggression;
            
            // Phase 3: Assign random long-term goals
            world._assignRandomGoals(faction);
            
            world.addFaction(faction);
        }
        
        // Set controlling faction for main town
        const centralTown = world.getLocation("town_central");
        if (centralTown) {
            centralTown.controllingFactionId = "kingdom";
        }
        
        // Starter NPCs make the deterministic mechanics immediately playable.
        const merchant = new NPC('npc_market_merchant', 'market_square', 'merchants_guild');
        merchant.name = 'Market Merchant';
        merchant.isMerchant = true;
        merchant.gold = 500;
        merchant.inventory = createFullMerchantInventory();
        world.addNPC(merchant);

        const warden = new NPC('npc_town_warden', 'town_central', 'kingdom');
        warden.name = 'Town Warden';
        warden.isQuestGiver = true;
        world.addNPC(warden);

        const bandit = new NPC('npc_forest_bandit', 'forest_entrance', 'thieves_guild');
        bandit.name = 'Forest Bandit';
        bandit.hp = 45;
        bandit.maxHp = 45;
        bandit.attack = 7;
        bandit.defense = 1;
        bandit.armorClass = 11;
        bandit.damageDice = '1d6';
        bandit.goldReward = 30;
        bandit.xpReward = 25;
        bandit.loot = [{ id: 'bread', quantity: 1 }];
        world.addNPC(bandit);

        // Create player
        const player = new Player(playerName, playerLocationId);
        player.addItem('bread', 2);
        player.addItem('healing_potion', 1);
        world.setPlayer(player);
        
        // Set initial reputation
        player.setReputation("kingdom", 10);
        player.setReputation("merchants_guild", 0);
        player.setReputation("thieves_guild", -10);
        
        return world;
    }
}

// ============================================================================
// NARRATIVE MEMORY V1
// ============================================================================
// This layer is deliberately separate from the simulation. It records only
// narrative facts and never changes Player/NPC/quest mechanics.

const NARRATIVE_MEMORY_VERSION = 1;
const NARRATIVE_MEMORY_CONSOLIDATION_TURNS = 6;
const NARRATIVE_MEMORY_MAX_TURNS = 240;
const NARRATIVE_MEMORY_MAX_CONTEXT_CHARS = 12000;
const NARRATIVE_FACT_KINDS = new Set([
    'appearance', 'relationship', 'promise', 'knowledge', 'event',
    'location_detail', 'rumor', 'secret'
]);
const NARRATIVE_SUBJECT_TYPES = new Set(['player', 'npc', 'location', 'faction', 'quest']);
const NARRATIVE_CERTAINTIES = new Set(['confirmed', 'claimed', 'rumor', 'false']);
const NARRATIVE_THREAD_STATUSES = new Set(['active', 'resolved', 'abandoned']);

function narrativeClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function narrativeStableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(narrativeStableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${narrativeStableStringify(value[key])}`).join(',')}}`;
}

function narrativeStringList(value, maxItems = 32, maxLength = 120) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .filter(item => typeof item === 'string')
        .map(item => item.trim().slice(0, maxLength))
        .filter(Boolean))].slice(0, maxItems);
}

/**
 * Persisted long-term narrative memory. Facts are a ledger: superseded facts
 * remain in the ledger for history, while indexes point to the active version.
 */
class NarrativeMemory {
    constructor() {
        this.schemaVersion = NARRATIVE_MEMORY_VERSION;
        this.revision = 0;
        this.lastConsolidatedTurn = 0;
        this.turns = [];
        this.facts = new Map();
        this.episodes = [];
        this.threads = new Map();
        this.indexes = {
            bySubject: new Map(),
            byLocation: new Map(),
            byTag: new Map(),
            byCanonicalKey: new Map()
        };
        this._idCounter = 0;
    }

    _makeId(prefix) {
        this._idCounter += 1;
        return `${prefix}_${Date.now().toString(36)}_${this._idCounter.toString(36)}`;
    }

    _subjectKey(subject) {
        return subject && subject.type && subject.id ? `${subject.type}:${subject.id}` : null;
    }

    _indexAdd(index, key, id) {
        if (!key) return;
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(id);
    }

    _indexFact(fact) {
        this._indexAdd(this.indexes.bySubject, this._subjectKey(fact.subject), fact.id);
        this._indexAdd(this.indexes.byLocation, fact.locationId, fact.id);
        for (const tag of fact.tags) this._indexAdd(this.indexes.byTag, tag, fact.id);
        if (fact.state === 'active') this.indexes.byCanonicalKey.set(fact.canonicalKey, fact.id);
    }

    _rebuildIndexes() {
        this.indexes = {
            bySubject: new Map(), byLocation: new Map(), byTag: new Map(), byCanonicalKey: new Map()
        };
        for (const fact of this.facts.values()) this._indexFact(fact);
    }

    _isMechanicalKey(value) {
        const key = String(value || '').toLocaleLowerCase('en-US');
        return /(^|[._:\-\s])(hp|maxhp|gold|inventory|xp|level|stats?|strength|dexterity|constitution|intelligence|wisdom|charisma|quest[._:\-\s]*(status|reward)|rewards?|isalive|alive|dead|death|killed)([._:\-\s]|$)/.test(key);
    }

    _validateFact(rawFact) {
        if (!rawFact || typeof rawFact !== 'object') return { ok: false, error: 'Fact must be an object.' };
        if (!NARRATIVE_FACT_KINDS.has(rawFact.kind)) return { ok: false, error: 'Unsupported narrative fact kind.' };
        const subject = rawFact.subject;
        if (!subject || !NARRATIVE_SUBJECT_TYPES.has(subject.type) || typeof subject.id !== 'string' || !subject.id.trim()) {
            return { ok: false, error: 'Fact subject is invalid.' };
        }
        if (typeof rawFact.predicate !== 'string' || !rawFact.predicate.trim() || rawFact.predicate.length > 160) {
            return { ok: false, error: 'Fact predicate is invalid.' };
        }
        const canonicalKey = String(rawFact.canonicalKey || `${subject.type}:${subject.id}:${rawFact.predicate}`).trim();
        if (!canonicalKey || canonicalKey.length > 240 || this._isMechanicalKey(rawFact.predicate) || this._isMechanicalKey(canonicalKey)) {
            return { ok: false, error: 'Narrative memory cannot change mechanical state.' };
        }
        if (!NARRATIVE_CERTAINTIES.has(rawFact.certainty || 'claimed')) return { ok: false, error: 'Fact certainty is invalid.' };
        const importance = Number(rawFact.importance);
        if (!Number.isFinite(importance) || importance < 0 || importance > 1) return { ok: false, error: 'Fact importance must be between 0 and 1.' };
        if (!Object.prototype.hasOwnProperty.call(rawFact, 'value')) return { ok: false, error: 'Fact value is required.' };
        try { narrativeStableStringify(rawFact.value); } catch (error) { return { ok: false, error: 'Fact value must be JSON serializable.' }; }
        return {
            ok: true,
            value: {
                id: typeof rawFact.id === 'string' && rawFact.id ? rawFact.id : this._makeId('fact'),
                kind: rawFact.kind,
                subject: { type: subject.type, id: subject.id.trim().slice(0, 120) },
                predicate: rawFact.predicate.trim(),
                value: narrativeClone(rawFact.value),
                canonicalKey,
                certainty: rawFact.certainty || 'claimed',
                importance,
                tags: narrativeStringList(rawFact.tags),
                relatedIds: narrativeStringList(rawFact.relatedIds),
                locationId: typeof rawFact.locationId === 'string' && rawFact.locationId.trim() ? rawFact.locationId.trim().slice(0, 120) : null,
                knownBy: narrativeStringList(rawFact.knownBy),
                directorOnly: rawFact.directorOnly === true,
                source: {
                    turnId: typeof rawFact.source?.turnId === 'string' ? rawFact.source.turnId.slice(0, 120) : null,
                    speakerId: typeof rawFact.source?.speakerId === 'string' ? rawFact.source.speakerId.slice(0, 120) : null,
                    kind: typeof rawFact.source?.kind === 'string' ? rawFact.source.kind.slice(0, 80) : 'narrative_patch',
                    gameTime: Number.isFinite(Number(rawFact.source?.gameTime)) ? Number(rawFact.source.gameTime) : 0
                },
                state: 'active',
                validFrom: Number.isFinite(Number(rawFact.source?.gameTime)) ? Number(rawFact.source.gameTime) : 0,
                validTo: null,
                supersedes: [],
                supersededBy: null,
                createdAtRevision: this.revision + 1,
                updatedAtRevision: this.revision + 1
            }
        };
    }

    _isCurrentFact(fact) {
        return /(^|\.)current(\.|$)/i.test(fact.predicate) || /^appearance\.current\./i.test(fact.predicate);
    }

    _upsertFact(incoming) {
        const activeId = this.indexes.byCanonicalKey.get(incoming.canonicalKey);
        const active = activeId ? this.facts.get(activeId) : null;
        if (!active) {
            this.facts.set(incoming.id, incoming);
            this._indexFact(incoming);
            return { status: 'created', id: incoming.id };
        }

        if (narrativeStableStringify(active.value) === narrativeStableStringify(incoming.value)) {
            active.importance = Math.max(active.importance, incoming.importance);
            active.tags = narrativeStringList(active.tags.concat(incoming.tags));
            active.relatedIds = narrativeStringList(active.relatedIds.concat(incoming.relatedIds));
            active.knownBy = narrativeStringList(active.knownBy.concat(incoming.knownBy));
            active.updatedAtRevision = this.revision + 1;
            this._rebuildIndexes();
            return { status: 'unchanged', id: active.id };
        }

        const incomingCanReplace = incoming.certainty === 'confirmed' && (active.certainty !== 'confirmed' || this._isCurrentFact(incoming));
        if (incomingCanReplace) {
            active.state = 'superseded';
            active.validTo = incoming.validFrom;
            active.supersededBy = incoming.id;
            active.updatedAtRevision = this.revision + 1;
            incoming.supersedes = [active.id];
            this.facts.set(incoming.id, incoming);
            this._rebuildIndexes();
            return { status: 'superseded', id: incoming.id, previousId: active.id };
        }

        // A rumor or claim must never overwrite a confirmed fact. Preserve it as
        // a disputed historical assertion instead of silently losing it.
        incoming.state = 'disputed';
        incoming.canonicalKey = `${incoming.canonicalKey}#disputed:${incoming.id}`;
        this.facts.set(incoming.id, incoming);
        this._indexFact(incoming);
        return { status: 'disputed', id: incoming.id, previousId: active.id };
    }

    recordTurn(turn = {}) {
        const userText = typeof turn.userText === 'string' ? turn.userText.trim() : '';
        const narratorText = typeof turn.narratorText === 'string' ? turn.narratorText.trim() : '';
        if (!userText || !narratorText) return { recorded: false, error: 'A complete turn requires userText and narratorText.' };
        const id = typeof turn.id === 'string' && turn.id.trim() ? turn.id.trim().slice(0, 120) : this._makeId('turn');
        const existing = this.turns.find(item => item.id === id);
        if (existing) return { recorded: true, id: existing.id, duplicate: true };
        const entry = {
            id,
            actorId: typeof turn.actorId === 'string' ? turn.actorId.slice(0, 120) : null,
            userText: userText.slice(0, 8000),
            narratorText: narratorText.slice(0, 12000),
            locationId: typeof turn.locationId === 'string' ? turn.locationId.slice(0, 120) : null,
            participantIds: narrativeStringList(turn.participantIds),
            gameTime: Number.isFinite(Number(turn.gameTime)) ? Number(turn.gameTime) : 0,
            complete: true,
            consolidated: false
        };
        this.turns.push(entry);
        if (this.turns.length > NARRATIVE_MEMORY_MAX_TURNS) this.turns.splice(0, this.turns.length - NARRATIVE_MEMORY_MAX_TURNS);
        this.revision += 1;
        return { recorded: true, id };
    }

    getPendingTurns(limit = NARRATIVE_MEMORY_CONSOLIDATION_TURNS) {
        return this.turns.filter(turn => turn.complete && !turn.consolidated).slice(0, limit);
    }

    shouldConsolidate() {
        return this.getPendingTurns().length >= NARRATIVE_MEMORY_CONSOLIDATION_TURNS;
    }

    buildConsolidationInput() {
        const turns = this.getPendingTurns();
        const entityIds = new Set();
        const locationIds = new Set();
        for (const turn of turns) {
            if (turn.actorId) entityIds.add(turn.actorId);
            for (const participantId of turn.participantIds) entityIds.add(participantId);
            if (turn.locationId) locationIds.add(turn.locationId);
        }
        const activeFacts = Array.from(this.facts.values()).filter(fact =>
            fact.state === 'active' && (
                entityIds.has(fact.subject.id) || fact.relatedIds.some(id => entityIds.has(id)) || locationIds.has(fact.locationId)
            )
        ).map(narrativeClone);
        return { version: NARRATIVE_MEMORY_VERSION, turns: narrativeClone(turns), activeFacts };
    }

    _validatePatch(patch) {
        if (!patch || typeof patch !== 'object' || patch.version !== NARRATIVE_MEMORY_VERSION) {
            return { ok: false, error: 'Unsupported narrative memory patch version.' };
        }
        if (patch.facts !== undefined && !Array.isArray(patch.facts)) return { ok: false, error: 'Patch facts must be an array.' };
        if (patch.retractions !== undefined && !Array.isArray(patch.retractions)) return { ok: false, error: 'Patch retractions must be an array.' };
        if (patch.threads !== undefined && !Array.isArray(patch.threads)) return { ok: false, error: 'Patch threads must be an array.' };
        const facts = [];
        for (const rawFact of patch.facts || []) {
            const checked = this._validateFact(rawFact);
            if (!checked.ok) return checked;
            facts.push(checked.value);
        }
        for (const retraction of patch.retractions || []) {
            const key = typeof retraction?.canonicalKey === 'string' ? retraction.canonicalKey.trim() : '';
            if (!key || this._isMechanicalKey(key)) return { ok: false, error: 'Retraction key is invalid or mechanical.' };
        }
        if (patch.episode !== undefined && patch.episode !== null) {
            const episode = patch.episode;
            if (typeof episode.title !== 'string' || typeof episode.summary !== 'string' || !Array.isArray(episode.turnIds) || !Number.isFinite(Number(episode.importance)) || Number(episode.importance) < 0 || Number(episode.importance) > 1) {
                return { ok: false, error: 'Episode is invalid.' };
            }
        }
        // A consolidation patch is only successful when it actually consumes
        // the exact batch it was asked to summarize. Without this guard a
        // valid-looking empty patch would leave six turns pending forever and
        // cause every later action to retry the same batch.
        const pendingTurnIds = this.getPendingTurns().map(turn => turn.id);
        if (pendingTurnIds.length >= NARRATIVE_MEMORY_CONSOLIDATION_TURNS) {
            if (!patch.episode) return { ok: false, error: 'A consolidation patch must include an episode.' };
            const episodeTurnIds = narrativeStringList(patch.episode.turnIds, NARRATIVE_MEMORY_CONSOLIDATION_TURNS + 1);
            const expectedTurnIds = new Set(pendingTurnIds);
            if (episodeTurnIds.length !== pendingTurnIds.length || episodeTurnIds.some(id => !expectedTurnIds.has(id))) {
                return { ok: false, error: 'Episode turnIds must match the pending consolidation batch.' };
            }
        }
        for (const thread of patch.threads || []) {
            if (!thread || typeof thread.id !== 'string' || !thread.id.trim() || typeof thread.title !== 'string' || typeof thread.summary !== 'string' || !NARRATIVE_THREAD_STATUSES.has(thread.status) || !Number.isFinite(Number(thread.importance)) || Number(thread.importance) < 0 || Number(thread.importance) > 1) {
                return { ok: false, error: 'Thread is invalid.' };
            }
        }
        return { ok: true, facts };
    }

    applyPatch(patch) {
        const validation = this._validatePatch(patch);
        if (!validation.ok) return { success: false, error: validation.error, retainedPendingTurns: this.getPendingTurns().length };
        const changes = validation.facts.map(fact => this._upsertFact(fact));
        for (const retraction of patch.retractions || []) {
            for (const fact of this.facts.values()) {
                if (fact.canonicalKey === retraction.canonicalKey && fact.state === 'active') {
                    fact.state = 'retracted';
                    fact.validTo = Number.isFinite(Number(retraction.gameTime)) ? Number(retraction.gameTime) : fact.validFrom;
                }
            }
        }
        if (patch.episode) {
            const episode = {
                id: typeof patch.episode.id === 'string' && patch.episode.id ? patch.episode.id : this._makeId('episode'),
                title: patch.episode.title.slice(0, 160),
                summary: patch.episode.summary.slice(0, 2400),
                turnIds: narrativeStringList(patch.episode.turnIds, 32),
                importance: Number(patch.episode.importance),
                tags: narrativeStringList(patch.episode.tags),
                entityIds: narrativeStringList(patch.episode.entityIds),
                locationId: typeof patch.episode.locationId === 'string' ? patch.episode.locationId.slice(0, 120) : null,
                // The public patch contract has no audience field on episodes;
                // it is public unless the caller explicitly supplies one.
                knownBy: Object.prototype.hasOwnProperty.call(patch.episode, 'knownBy')
                    ? narrativeStringList(patch.episode.knownBy)
                    : ['public'],
                directorOnly: patch.episode.directorOnly === true
            };
            this.episodes.push(episode);
            const consolidatedIds = new Set(episode.turnIds);
            for (const turn of this.turns) if (consolidatedIds.has(turn.id)) turn.consolidated = true;
            this.lastConsolidatedTurn = this.turns.filter(turn => turn.consolidated).length;
        }
        for (const rawThread of patch.threads || []) {
            this.threads.set(rawThread.id, {
                id: rawThread.id.slice(0, 120), title: rawThread.title.slice(0, 160), summary: rawThread.summary.slice(0, 1600),
                status: rawThread.status, importance: Number(rawThread.importance),
                entityIds: narrativeStringList(rawThread.entityIds),
                locationId: typeof rawThread.locationId === 'string' ? rawThread.locationId.slice(0, 120) : null,
                knownBy: Object.prototype.hasOwnProperty.call(rawThread, 'knownBy')
                    ? narrativeStringList(rawThread.knownBy)
                    : ['public'],
                directorOnly: rawThread.directorOnly === true
            });
        }
        this.revision += 1;
        this._rebuildIndexes();
        return { success: true, changes, consolidatedTurns: patch.episode?.turnIds?.length || 0 };
    }

    _appearanceNeeds(query) {
        const text = `${query.action || ''} ${query.text || ''} ${query.sceneType || ''} ${(query.tags || []).join(' ')}`.toLocaleLowerCase('pl-PL');
        return {
            face: /recognition|mirror|portrait|identity|disguise|first[ -]?impression|rozpozn|lust|portret|tożsamo|przebran|pierwsz.{0,8}wraż/.test(text),
            clothing: /clothing|weather|damage|combat|disguise|inspection|first[ -]?impression|ubran|strój|płaszcz|pogod|deszcz|walka|obraż|przebran|oględzin|inspek|pierwsz.{0,8}wraż/.test(text)
        };
    }

    _isClothingAppearanceFact(fact) {
        const descriptor = `${fact?.predicate || ''} ${(fact?.tags || []).join(' ')}`.toLocaleLowerCase('pl-PL');
        return /clothing|clothes|outfit|outerwear|armor|armour|wearing|garment|attire|wardrobe|dress|robe|cloak|cape|uniform|boots?|shoes?|\bwear\b|ubran|strój|odzież|płaszcz|zbroj|pancerz|nosz|szat|but|kurtk|mundur|sukni/.test(descriptor);
    }

    _visibleTo(fact, viewerId, includeDirectorSecrets) {
        if (includeDirectorSecrets && fact.directorOnly) return true;
        if (fact.directorOnly || !viewerId) return false;
        return fact.knownBy.includes(viewerId) || fact.knownBy.includes('*') || fact.knownBy.includes('public');
    }

    _scoreItem(item, query, type) {
        const entityIds = new Set(narrativeStringList([].concat(query.entityIds || [], query.npcIds || [], query.playerId || [])));
        const tags = new Set(narrativeStringList(query.tags));
        let score = 0;
        const ids = type === 'fact' ? [item.subject.id].concat(item.relatedIds) : item.entityIds || [];
        if (ids.some(id => entityIds.has(id))) score += 0.30;
        if (query.locationId && item.locationId === query.locationId) score += 0.20;
        if (type === 'thread' && item.status === 'active') score += 0.20;
        score += Math.max(0, Math.min(1, Number(item.importance) || 0)) * 0.15;
        const itemTags = item.tags || [];
        if (itemTags.some(tag => tags.has(tag))) score += 0.10;
        if (type === 'fact' && item.state === 'active') score += 0.10;
        if (type === 'episode' && item.turnIds?.some(id => this.turns.find(turn => turn.id === id && !turn.consolidated))) score += 0.05;
        return score;
    }

    buildContext(query = {}) {
        const maxChars = Math.max(200, Math.min(Number(query.maxChars) || NARRATIVE_MEMORY_MAX_CONTEXT_CHARS, NARRATIVE_MEMORY_MAX_CONTEXT_CHARS));
        const appearance = this._appearanceNeeds(query);
        const viewerId = typeof query.viewerId === 'string' ? query.viewerId : null;
        const includeDirectorSecrets = query.includeDirectorSecrets === true;
        const candidates = [];
        for (const fact of this.facts.values()) {
            if (fact.state !== 'active' || !this._visibleTo(fact, viewerId, includeDirectorSecrets)) continue;
            // Models do not reliably follow canonical predicate names. Every
            // appearance fact is scene-gated by kind; clothing keywords in its
            // predicate/tags choose the clothing gate, everything else is an
            // identity (face/body) detail.
            if (fact.kind === 'appearance') {
                if (this._isClothingAppearanceFact(fact) && !appearance.clothing) continue;
                if (!this._isClothingAppearanceFact(fact) && !appearance.face) continue;
            }
            candidates.push({ type: fact.directorOnly ? 'directorSecret' : 'fact', item: fact, score: this._scoreItem(fact, query, 'fact') });
        }
        for (const episode of this.episodes) {
            if (!this._visibleTo(episode, viewerId, includeDirectorSecrets)) continue;
            candidates.push({ type: episode.directorOnly ? 'directorSecret' : 'episode', item: episode, score: this._scoreItem(episode, query, 'episode') });
        }
        for (const thread of this.threads.values()) {
            if (!this._visibleTo(thread, viewerId, includeDirectorSecrets)) continue;
            candidates.push({ type: thread.directorOnly ? 'directorSecret' : 'thread', item: thread, score: this._scoreItem(thread, query, 'thread') });
        }
        candidates.sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)));
        const context = { facts: [], episodes: [], threads: [], directorSecrets: [], charsUsed: 0, maxChars };
        for (const candidate of candidates) {
            const size = JSON.stringify(candidate.item).length;
            if (context.charsUsed + size > maxChars) continue;
            context.charsUsed += size;
            context[candidate.type === 'directorSecret' ? 'directorSecrets' : `${candidate.type}s`].push(narrativeClone(candidate.item));
        }
        return context;
    }

    toViewerJSON(viewerId) {
        const visibleFacts = Array.from(this.facts.values()).filter(fact => this._visibleTo(fact, viewerId, false));
        const visibleEpisodes = this.episodes.filter(episode => this._visibleTo(episode, viewerId, false));
        const visibleThreads = Array.from(this.threads.values()).filter(thread => this._visibleTo(thread, viewerId, false));
        return {
            schemaVersion: this.schemaVersion, revision: this.revision, lastConsolidatedTurn: this.lastConsolidatedTurn,
            turns: [], facts: narrativeClone(visibleFacts), episodes: narrativeClone(visibleEpisodes), threads: narrativeClone(visibleThreads)
        };
    }

    toJSON() {
        return {
            schemaVersion: this.schemaVersion, revision: this.revision, lastConsolidatedTurn: this.lastConsolidatedTurn,
            turns: narrativeClone(this.turns), facts: narrativeClone(Array.from(this.facts.values())),
            episodes: narrativeClone(this.episodes), threads: narrativeClone(Array.from(this.threads.values()))
        };
    }

    static fromJSON(json) {
        const memory = new NarrativeMemory();
        if (!json || typeof json !== 'object') return memory;
        memory.schemaVersion = NARRATIVE_MEMORY_VERSION;
        memory.revision = Number.isSafeInteger(json.revision) && json.revision >= 0 ? json.revision : 0;
        memory.lastConsolidatedTurn = Number.isSafeInteger(json.lastConsolidatedTurn) && json.lastConsolidatedTurn >= 0 ? json.lastConsolidatedTurn : 0;
        for (const turn of Array.isArray(json.turns) ? json.turns : []) {
            if (turn && typeof turn.id === 'string' && typeof turn.userText === 'string' && typeof turn.narratorText === 'string') {
                memory.turns.push({ ...narrativeClone(turn), complete: turn.complete !== false, consolidated: turn.consolidated === true });
            }
        }
        for (const rawFact of Array.isArray(json.facts) ? json.facts : []) {
            const checked = memory._validateFact(rawFact);
            if (!checked.ok) continue;
            const fact = { ...checked.value, ...narrativeClone(rawFact), id: checked.value.id, subject: checked.value.subject, tags: narrativeStringList(rawFact.tags), relatedIds: narrativeStringList(rawFact.relatedIds), knownBy: narrativeStringList(rawFact.knownBy) };
            fact.state = ['active', 'historical', 'superseded', 'retracted', 'disputed'].includes(rawFact.state) ? rawFact.state : 'active';
            memory.facts.set(fact.id, fact);
        }
        memory.episodes = (Array.isArray(json.episodes) ? json.episodes : []).filter(item => item && typeof item.summary === 'string').map(item => ({
            ...narrativeClone(item),
            knownBy: Object.prototype.hasOwnProperty.call(item, 'knownBy') ? narrativeStringList(item.knownBy) : ['public']
        }));
        for (const item of Array.isArray(json.threads) ? json.threads : []) {
            if (item && typeof item.id === 'string' && NARRATIVE_THREAD_STATUSES.has(item.status)) {
                memory.threads.set(item.id, {
                    ...narrativeClone(item),
                    knownBy: Object.prototype.hasOwnProperty.call(item, 'knownBy') ? narrativeStringList(item.knownBy) : ['public']
                });
            }
        }
        memory._rebuildIndexes();
        return memory;
    }

    static migrateLegacy(historyNodes = []) {
        const memory = new NarrativeMemory();
        memory.episodes = (Array.isArray(historyNodes) ? historyNodes : []).filter(node => node && typeof node.summaryText === 'string' && node.summaryText.trim()).map((node, index) => ({
            id: `legacy_episode_${node.nodeId || index}`,
            title: 'Legacy history', summary: node.summaryText.slice(0, 2400), turnIds: [],
            importance: Math.max(0, Math.min(1, Number(node.finalImportance || node.staticImportance || 0))),
            tags: Array.isArray(node.tags) ? node.tags : Array.from(node.tags || []), entityIds: [], locationId: null,
            knownBy: ['public'], directorOnly: false
        }));
        return memory;
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        World,
        Location,
        Faction,
        NPC,
        Player,
        StatusEffect,
        WorldChange,
        ActionResult,
        NarrativeMemory,
        WorldEvent,
        EventQueue,
        MinHeap,
        IMPORTANCE_TABLE,
        DEFAULT_REGEN,
        DEFAULT_CONSUMPTION,
        STATUS_THRESHOLDS,
        EVENT_LIMITS,
        STRATEGIC_UPDATE_INTERVAL,
        ITEM_CATALOG,
        EQUIPMENT_SLOTS
    };
}

if (typeof window !== 'undefined') {
    window.RPGEngine = {
        World,
        Location,
        Faction,
        NPC,
        Player,
        StatusEffect,
        WorldChange,
        ActionResult,
        NarrativeMemory,
        WorldEvent,
        EventQueue,
        MinHeap,
        IMPORTANCE_TABLE,
        DEFAULT_REGEN,
        DEFAULT_CONSUMPTION,
        STATUS_THRESHOLDS,
        EVENT_LIMITS,
        STRATEGIC_UPDATE_INTERVAL,
        ITEM_CATALOG,
        EQUIPMENT_SLOTS
    };
}
