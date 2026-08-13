# RPG 2.0 — roadmap techniczna

Ten dokument opisuje kolejność rozwijania prototypu w otwarte, multiplayerowe RPG.

## Zasady architektury

1. Serwer jest źródłem prawdy dla HP, EXP, statystyk, złota, przedmiotów, NPC, sklepów i wyników kości.
2. Narrator AI opisuje sytuację oraz może sklasyfikować akcję, ale nie może samodzielnie dopisać mechanicznej konsekwencji.
3. Każda zmiana mechaniczna jest zdarzeniem z `actionId`, aktorem, celem, czasem świata i wynikiem.
4. Świat scenariusza jest otwarty: scenariusz dostarcza konfliktów, NPC i możliwości, ale nie wymusza kolejności lokacji.
5. Dane prywatne postaci i dane publiczne pokoju są rozdzielone.

## Wdrożone w pierwszym pionowym fragmencie

- konta `mat` i `rob` z hasłami konfigurowanymi przez sekrety środowiskowe;
- hash haseł przez scrypt, bez przechowywania haseł ani hashy w repozytorium;
- tokenowe sesje kont;
- limit nieudanych logowań;
- relacja znajomych Mat–Rob;
- status online przez Socket.IO;
- panel znajomych i zaproszeń;
- zaproszenie do aktywnego pokoju;
- przyjęcie zaproszenia i automatyczne wpisanie ID pokoju;
- przypisanie zapisanego stanu gracza do konta;
- zapis lokalny przez adapter `data/auth.json`.

## Etap A — trwałość danych

Obecny adapter plikowy zostaje interfejsem przejściowym. Przed większą liczbą graczy należy dodać PostgreSQL na Railway.

### Tabele

- `users(id, username, display_name, password_hash, created_at)`;
- `sessions(id, user_id, token_hash, expires_at, created_at)`;
- `friendships(user_a, user_b, status, requested_by, updated_at)`;
- `campaigns(id, owner_id, name, scenario_id, status, created_at)`;
- `campaign_members(campaign_id, user_id, character_id, role)`;
- `characters(id, owner_id, name, definition_json, created_at)`;
- `world_snapshots(campaign_id, version, state_json, created_at)`;
- `game_events(id, campaign_id, action_id, actor_id, type, payload_json, created_at)`.

Migracja musi zachować istniejące `rooms.json` i `auth.json`. Najpierw import, potem przełączenie odczytu, a dopiero na końcu wyłączenie zapisu plikowego.

## Etap B — konta, znajomi i lobby

Do wykonania:

- wyszukiwanie po loginie;
- akceptowanie, odrzucanie i usuwanie znajomych;
- lista zaproszeń z wygasaniem;
- kampanie widoczne tylko dla członków;
- wybór postaci należącej do zalogowanego konta;
- rozłączenie i ponowne dołączenie bez utraty tożsamości;
- host, współhost i uprawnienia do ustawień kampanii.

## Etap C — model postaci — bazowa wersja wdrożona

Postać otrzyma sześć cech: Siła, Zręczność, Kondycja, Inteligencja, Mądrość i Charyzma.

Wdrożone w pierwszym kroku:

- sześć cech z wartością bazową 10;
- pula 27 punktów oraz przycisk rozdawania punktów w karcie postaci;
- limit 20 na pojedynczą cechę;
- modyfikatory cech wpływające na atak, obronę i testy;
- zapis oraz odtwarzanie statystyk, poziomu, EXP i punktów po stronie serwera.

Do uzupełnienia: walidacja statystyk podczas tworzenia postaci, pochodzenie, archetyp, biegłości i pełny model umiejętności.

Rozwój:

- `xp` za odkrywanie, zadania i starcia;
- poziom i punkty rozwoju;
- osobne premie umiejętności;
- zapis poziomu i EXP w stanie postaci, nigdy w odpowiedzi AI.

## Etap D — d20 i akcje wymagające testu — bazowa wersja wdrożona

Przepływ:

```text
akcja gracza → klasyfikacja → test utworzony przez silnik → kliknięcie kości
→ rzut na serwerze → obliczenie → zdarzenie → opis narratora
```

Przykładowy oczekujący test:

```json
{
  "id": "roll_123",
  "actionId": "action_123",
  "actorId": "character_mat",
  "kind": "attack",
  "ability": "strength",
  "modifier": 5,
  "difficulty": 17,
  "status": "pending"
}
```

Wdrożone: oczekujący test w Socket.IO, serwerowe losowanie przez `crypto.randomInt(1, 21)`, naturalne 1 i 20, testy ataku oraz kilka testów ogólnych, konsekwencje w silniku i panel wyniku widoczny dla całej drużyny. Klient nie wysyła liczby.

Do uzupełnienia: jawne `actionId`, przewaga/utrudnienie, rzuty przeciwstawne, inicjatywa i rozbudowana klasyfikacja umiejętności.

## Etap E — otwarte scenariusze

Scenariusz składa się z:

- regionów i odkrywanych lokacji;
- NPC z celami, pamięcią i relacjami;
- frakcji;
- głównego konfliktu bez narzuconej kolejności;
- zadań głównych, pobocznych i emergentnych;
- zegarów wydarzeń;
- reakcji świata na decyzje;
- wielu możliwych zakończeń.

Narrator ma obowiązek respektować bieżące przejścia, stan lokacji i rezultat mechaniki. Jeżeli gracz ignoruje główny wątek, świat rozwija się w tle zamiast teleportować gracza do kolejnego punktu fabuły.

## Etap F — walka

Najpierw wersja deterministyczna:

- atak przeciw obronie;
- obrażenia z kości broni;
- pancerz i redukcja;
- stamina;
- statusy;
- nieprzytomność i leczenie;
- EXP i łupy.

Potem inicjatywa, tury, dystans, osłony, zdolności i walka grupowa.

## Etap G — przedmioty i wyposażenie — pierwsza wersja wdrożona

Wdrożone: stały katalog przedmiotów z pixelartowymi ikonami, plecak w interfejsie, sloty broni/pancerza/drugiej ręki/akcesorium, zakładanie i zdejmowanie przez akcję serwerową oraz wpływ wyposażenia na atak, obronę i modyfikatory cech. Ikony znajdują się w `assets/items/` i są ładowane jako przezroczyste PNG z pixelowym skalowaniem.

Definicje przedmiotów są stałe, a egzemplarze mają własną trwałość, jakość i właściciela.

```text
item_definition → item_instance → inventory_entry → equipment_slot
```

Do uzupełnienia: trwałość, jakość, ciężar, porównanie przedmiotów, osobne egzemplarze i pełne sloty ubioru.

## Etap H — sklepy i gospodarka

Kupiec posiada własny magazyn, złoto, preferencje, reputację i ceny. Zakup jest transakcją serwerową. Dwie równoczesne próby zakupu ostatniej sztuki rozstrzyga blokada lub transakcja bazy, więc przedmiot nie zostanie wydany dwóm graczom.

## Etap I — pamięć AI

Kontekst jest rozdzielony na:

- stan mechaniczny z silnika;
- fakty świata;
- wiedzę konkretnego gracza;
- pamięć NPC;
- aktywne tropy;
- ostatnie tury sceny.

Do OpenRouter trafia tylko kontekst potrzebny do aktualnej odpowiedzi. Wynik AI jest walidowany i nie może zmieniać chronionych pól mechanicznych.

## Etap J — testy i produkcja

Każdy etap wymaga testów:

- restart serwera;
- ponowne połączenie;
- dwóch graczy w jednym pokoju;
- równoczesny zakup;
- pojedynczy rzut d20;
- próba ponowienia tego samego `actionId`;
- prywatność wiedzy NPC;
- zapis i migracja świata;
- pełny test przeglądarkowy lobby.

Produkcja powinna działać z PostgreSQL, jednym aktywnym procesem Socket.IO albo adapterem Redis przy skalowaniu do wielu replik, wymuszonym HTTPS i sekretami wyłącznie w zmiennych Railway.
