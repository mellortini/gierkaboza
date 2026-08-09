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
