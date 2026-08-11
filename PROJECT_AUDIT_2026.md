# Audyt prototypu RPG — 2026

## Wniosek

Projekt jest działającym prototypem tekstowego RPG z narratorem AI i trybem Socket.io. Nie był jeszcze pełnym systemem D&D: wcześniej narrator mógł opisywać skutki akcji bez zmiany stanu gry, a tryb multiplayer współdzielił jednego gracza w pokoju.

## Poprawione w tej iteracji

- `engine.js` ma deterministyczny punkt wejścia `World.performPlayerAction()` dla podróży, odpoczynku i rozmowy. Handel i walka są jawnie odrzucane, dopóki nie mają reguł i danych celu.
- Czas przyjmuje wyłącznie nieujemne bezpieczne liczby całkowite. Efekty statusów są naliczane za rzeczywistą liczbę aktywnych minut.
- Snapshot świata zawiera pełny stan silnika, kolejkę wydarzeń, pamięć zmian i metadane wygenerowanego świata.
- Multiplayer trzyma osobny `Player` dla każdego połączenia, szereguje akcje w pokoju i wysyła każdemu klientowi jego własny stan postaci.
- Pokoje i zapisane postacie są zapisywane w `data/rooms.json`; dodano odtwarzanie sesji po reconnect.
- Uzupełniono liczniki kolejki wydarzeń, obsługę wydarzeń strategicznych i bezpieczne anulowanie wydarzeń frakcji.
- Ograniczono podstawowe ścieżki XSS w historii, liście graczy i zapisach oraz dodano limit akcji na socket.
- Zapis lokalny używa jednego klucza (`rpg_save`), a plan wygenerowanego świata jest zachowywany w snapshotach.

## Mechaniki dodane w kolejnym etapie

- starter world zawiera kupca, zleceniodawcę zadania i przeciwnika w lesie;
- gracz ma przedmioty, złoto, XP, poziom, atak, obronę i listę questów;
- działają komendy kupna, sprzedaży, użycia przedmiotu, przyjęcia zadania i walki;
- nagrody, obrażenia, śmierć NPC, XP i postęp questa trafiają do `WorldChange` oraz zapisów;
- HUD pokazuje zawartość ekwipunku, a multiplayer otrzymuje pełny snapshot z NPC-ami.

## Nadal do zaprojektowania przed wersją gry

1. Głębsze reguły D&D: rzuty kośćmi, inicjatywa, pancerz, klasy, umiejętności, warunki zwycięstwa i rozbudowany sklep.
2. Trwała baza danych i migracje zamiast pliku JSON, jeśli gra ma działać na wielu instancjach Railway.
3. Uwierzytelnianie graczy i bezpieczny model kluczy AI. Obecnie klient przekazuje klucz serwerowi na czas narracji; nie należy traktować tego jako rozwiązania produkcyjnego.
4. Testy integracyjne przeglądarki i multiplayera uruchamiane automatycznie w CI.

## Uruchamianie testów

```powershell
npm test
node --check engine.js
node --check server.js
node --check app.js
```

## Generator swiata dodany

- model otrzymuje schemat JSON zamiast samego Markdownu;
- silnik waliduje blueprint i tworzy z niego lokacje, polaczenia, frakcje, NPC-ow i questy;
- serwer multiplayer potrafi utworzyc pokoj bezposrednio z blueprintu.

## Graf podrozy dodany

- starter world ma jawne polaczenia miedzy lokacjami: miasto, rynek, brama, las i ruiny;
- `World.performPlayerAction()` odrzuca probe przejscia do niepolaczonej lokacji;
- blueprinty bez zdefiniowanej topologii zachowuja kompatybilnosc wsteczna i pozwalaja na swobodna podroz.

## Generator swiata: poprawka

- generator wysyla teraz jednoznaczny prompt JSON bez sprzecznych instrukcji Markdown;
- nazwa i opis wskazanego uniwersum maja pierwszenstwo przed domyslnym fantasy;
- niepoprawna odpowiedz modelu nie uruchamia juz po cichu `Central Town` — uzytkownik dostaje komunikat i moze ponowic generowanie.

## Menedzer zapisow dodany

- zapisy lokalne maja nazwy i sa przechowywane jako biblioteka w `localStorage` pod kluczem `rpg_saves`;
- lista pokazuje postac, swiat, lokacje, date i liczbe wiadomosci;
- kazdy zapis mozna wczytac, wyeksportowac do JSON albo usunac;
- stary klucz `rpg_save` jest migrowany automatycznie do nowej biblioteki.

## Limit kontekstu LLM dodany

- tryb jednoosobowy wysyla do modelu tylko ostatnie 16 wiadomosci oraz skrocona pamiec swiata;
- multiplayer wysyla maksymalnie 20 ostatnich wiadomosci i okolo 18 tys. znakow historii;
- pelna historia pozostaje w pamieci gry i zapisach, ale nie zapelnia juz okna kontekstowego API;
- sugestie akcji korzystaja z tego samego ograniczonego kontekstu.

## NarrativeMemory v1 — pamięć długiej kampanii

- Kompletne tury gracza i narratora są archiwizowane jako pending turns, a konsolidacja uruchamia się co 6 ukończonych tur.
- Konsolidacja działa jako osobne, niskotemperaturowe wywołanie OpenRouter i zwraca JSON patch pamięci.
- Pamięć jest podzielona na strukturalne fakty, epizody i wątki. Fakty mają widoczność przez `knownBy` oraz `directorOnly`.
- Wygląd twarzy, ciała i ubrań jest zapisywany raz, ale pobierany do promptu wyłącznie dla scen, w których jest istotny: rozpoznanie, lustro, przebranie, inspekcja, pogoda, uszkodzenie, walka lub pierwsze wrażenie.
- Zmiana ubrania nie kasuje historii: poprzednie ubranie pozostaje jako fakt zastąpiony, a aktualny stan jest osobnym faktem.
- Niepoprawne patche i próby zmiany mechaniki (HP, złota, ekwipunku, XP, poziomu, statystyk lub statusu questa) są odrzucane. Pending turns pozostają zachowane po błędzie.
- Stare zapisy bez `narrativeMemory` są migrowane i nadal można je wczytać.
- Multiplayer używa stabilnych `playerId` i osobnych historii graczy oraz snapshotów filtrowanych względem widza.
- Wspólna narracja multiplayera korzysta obecnie wyłącznie z publicznej pamięci strukturalnej, aby nie ujawniać prywatnych faktów innym graczom.
- Pełne prompty pozostają ograniczone: wysyłany jest tylko bufor ostatnich tur oraz relewantna pamięć sceny.

### Ograniczenia NarrativeMemory v1

- Ekstrakcja używa skonfigurowanego modelu i klucza OpenRouter; może się nie udać, a ponowienie nastąpi dopiero przy późniejszej ukończonej turze.
- `data/rooms.json` na Railway pozostaje nietrwałe bez skonfigurowanego Volume albo prawdziwej bazy danych.
- Nie ma jeszcze automatycznych testów E2E przeglądarki ani testów Socket.io obejmujących pełny przepływ pamięci.

## Kampania scenariuszowa: Popioły pod Zieloną Doliną

Do prototypu dodano gotową, kooperacyjną kampanię `Popioły pod Zieloną Doliną`. To mroczna opowieść o dolinie zbudowanej na zapomnianej zdradzie: gracze badają popiół trafiający do studni, historię wygnanych oraz podziemne palenisko przechowujące cudze wspomnienia. Kampania wspiera zarówno grę jednoosobową, jak i multiplayer.

### Wczytanie w UI

W zakładce „Plan Świata” znajduje się przycisk „Wczytaj gotową kampanię: Popioły pod Zieloną Doliną”. Aplikacja pobiera `/scenarios/popioly-pod-zielona-dolina.json`, waliduje blueprint przez `World.validateBlueprint`, ustawia nazwę, opis, plan i stan wygenerowanego świata, odświeża podgląd, a następnie prowadzi użytkownika do tworzenia postaci. Wczytany blueprint jest używany przy uruchamianiu gry; niepoprawny scenariusz nie jest po cichu zastępowany światem `town_central`.

### Struktura kampanii

- Cztery akty: I. „Popiół na wodzie”, II. „Dług ognia”, III. „Głosy pod ziemią” oraz IV. „Ziemia pamięta”. Akty prowadzą od śledztwa w dolinie przez zbieranie świadectw i zejście do paleniska do wyboru ceny finałowego rytuału.
- Główny łuk obejmuje sześć misji: odczytanie popiołu ze studni, rozmowę z echem młyna, zebranie trzech świadectw ognia, odkrycie pieczęci pierwszego wyroku, rozstrzygnięcie losu Pani z Pieca oraz podzielenie ceny pamięci. Dostępnych jest także dziewięć zadań pobocznych związanych z księgą wyroków, młotem Orwana, zielnikiem Celiny, pakunkiem Haldora, imieniem Janka, górnikami, maską Lidy, rozejmem Ruska i srebrną dłonią.
- Pięć frakcji: Rada Żniwiarzy, Kompania Bursztynu, Straż Popiołów, Bractwo Kory oraz Wolni Przewoźnicy. Każda ma publiczny cel, ukryty interes, metody działania, czerwone linie i relacje z pozostałymi grupami.
- Obsada obejmuje piętnaście ważnych NPC-ów, między innymi Mirę Wronę, Orwana Żelaznego, Celinę Rdest, Haldora Siatkę, siostrę Elgę, Tomasza Glinianego, Nelę Iskrę, brata Korwina, Lidę Mszak, Vargana Bursztyna, Ruska z Żaru, Matyldę Cichą, doktora Kruka, Janka z Popiołu i Panią z Pieca. NPC-e mają własne pragnienia, lęki, sekrety, powiązania i reakcje na decyzje graczy.
- Jedenaście wyborów scenariuszowych zmienia flagi i dalsze konsekwencje: dotyczą księgi wyroków, Neli, młota Orwana, kopalni, Ruska, maski Lidy, kontraktów Vargana, srebrnej dłoni, ujawnienia prawdy, losu paleniska i podziału kosztu rytuału.
- Cztery zakończenia to „Ogród Pamięci”, „Cicha Dolina”, „Rzeka Prawdy” i „Nowy Strażnik”. Warunki zależą od zarejestrowanych wyborów i flag, więc zakończenie nie jest ustalone z góry.

### Ukryte markery konsekwencji

Narrator otrzymuje instrukcję, aby po jednoznacznym rozstrzygnięciu wyboru dopisać na samym końcu dokładnie jeden marker w formacie `[[SCENARIO_CHOICE:{"choiceId":"...","optionId":"..."}]]`. W jednoosobowej i multiplayerowej ścieżce odpowiedź LLM jest natychmiast parsowana: poprawne identyfikatory są przekazywane wyłącznie do `world.recordScenarioChoice({ choiceId, optionId })`, a silnik sam stosuje zdefiniowane w scenariuszu `flagsAdd`, `flagsRemove` i `variables`. Parser usuwa marker przed zapisaniem historii, konsolidacją pamięci, wyświetleniem i broadcastem; markery niepoprawne są bezpiecznie usuwane i ignorowane. Model nie może samodzielnie dostarczać flag ani zmiennych.

W multiplayerze brief reżysera scenariusza pozostaje po stronie serwera. Klient otrzymuje wyłącznie filtrowany snapshot widza bez scenariusza, `scenarioState` i planu zawierającego tajne dane; tajny brief nie jest wysyłany klientom.
