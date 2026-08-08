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

## Nadal do zaprojektowania przed wersją gry

1. Prawdziwy model świata z generatora: plan AI powinien zwracać walidowany JSON lokacji, frakcji, NPC-ów i questów, a nie tylko Markdown.
2. Reguły D&D: statystyki, rzuty, inicjatywa, walka, przedmioty, handel, questy i warunki zwycięstwa.
3. Trwała baza danych i migracje zamiast pliku JSON, jeśli gra ma działać na wielu instancjach Railway.
4. Uwierzytelnianie graczy i bezpieczny model kluczy AI. Obecnie klient przekazuje klucz serwerowi na czas narracji; nie należy traktować tego jako rozwiązania produkcyjnego.
5. Testy integracyjne przeglądarki i multiplayera uruchamiane automatycznie w CI.

## Uruchamianie testów

```powershell
npm test
node --check engine.js
node --check server.js
node --check app.js
```
