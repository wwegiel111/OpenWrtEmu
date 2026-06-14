# Emulator OpenWrt / LuCI — TP-Link Archer C6

Pełni działający, **fullstackowy** emulator (klon) interfejsu **LuCI** systemu **OpenWrt**
dla routera **TP-Link Archer C6 v2 (AC1200)**. Odwzorowuje wygląd i działanie GUI
oraz konfigurację **LAN, WAN, Wi-Fi, DHCP/DNS i VLAN**. Przygotowany jako pomoc
do **egzaminu zawodowego INF.02 / EE.08** — z prostym resetem konfiguracji do stanu fabrycznego.

> Wyświetlana wersja firmware: **OpenWrt 5.12.1** (zgodnie z wymaganiem). Motyw: **ciemny**.

![ekran](public/img/openwrt-logo.svg)

## Funkcje

- 🖥️ **Wierne GUI LuCI** w trybie ciemnym (motyw „bootstrap/dark”): ekran logowania,
  górne menu (Status / System / Sieć / Pomoc), boczne podmenu, panele, formularze CBI,
  tabele statusu, toasty, modale.
- 🔐 **Logowanie** jak w OpenWrt: użytkownik `root`, hasło puste (świeży system) lub `admin`.
- 📊 **Status / Przegląd** — model, firmware, jądro, uptime, obciążenie, wykresy pamięci,
  status interfejsów, sieci Wi-Fi i aktywnych dzierżaw DHCP (dane odświeżane na żywo).
- 🌐 **Sieć → Interfejsy (LAN/WAN)** — protokoły: statyczny, DHCP, PPPoE, DHCPv6, none;
  adres IP, maska, brama, DNS, login/hasło PPPoE.
- 📶 **Sieć → Wi-Fi** — `radio0` (2.4 GHz, 802.11n) i `radio1` (5 GHz, 802.11ac):
  kanał, szerokość (HT/VHT), kod kraju, SSID, tryb AP/STA, szyfrowanie
  (otwarte / WPA2-PSK / WPA/WPA2 / WPA3-SAE), klucz, ukrywanie SSID, włącz/wyłącz radio.
- 🧩 **Sieć → DHCP i DNS** — pula adresów (start, limit, czas dzierżawy), Dnsmasq, domena lokalna.
- 🔀 **Sieć → Switch (VLAN)** — tablica VLAN przełącznika `switch0` z portami
  CPU/LAN1-4/WAN w trybach **off / untagged / tagged** (model swconfig MT7621).
- ⚙️ **System** — nazwa hosta, strefa czasowa; **Administracja** — zmiana hasła root.
- 💾 **Kopia zapasowa / Reset** — pobranie i przywrócenie konfiguracji (.json) oraz
  **przywrócenie ustawień fabrycznych** jednym kliknięciem (idealne przed nowym zadaniem).
- 🔁 **Workflow „Zapisz / Zapisz i zastosuj / Cofnij”** z licznikiem **niezapisanych zmian**
  — dokładnie jak w prawdziwym LuCI.
- 🎓 **Wskazówki egzaminacyjne** i **odpowiedniki poleceń UCI (CLI)** na każdej stronie.

## Uruchomienie

Wymagany jest tylko **Node.js ≥ 16** (projekt **nie ma żadnych zależności** — działa offline).

```bash
cd OpenWrtEmu
npm start          # lub: node server.js
```

Następnie otwórz w przeglądarce:

```
http://localhost:3000
```

Dane logowania:

| Użytkownik | Hasło |
|------------|-------|
| `root`     | *(puste)* lub `admin` |

Aby zmienić port: `PORT=8080 node server.js`.

## Reset konfiguracji (do ćwiczeń)

Trzy sposoby przywrócenia stanu fabrycznego:

1. **GUI:** *System → Kopia zapasowa / Reset → „Przywróć ustawienia fabryczne”*.
2. **API:** `curl -X POST http://localhost:3000/api/reset -H "Authorization: Bearer <token>"`.
3. **Plik:** zatrzymaj serwer i usuń `data/state.json` — przy starcie odtworzy się stan fabryczny.

Po resecie: LAN `192.168.1.1/24`, WAN = klient DHCP, Wi-Fi `OpenWrt` / `OpenWrt-5G` (otwarte),
serwer DHCP 192.168.1.100–249, hasło puste.

## Architektura

```
OpenWrtEmu/
├── server.js              # Serwer HTTP (wbudowany moduł 'http') + REST API + pliki statyczne
├── lib/
│   ├── defaults.js        # Fabryczna konfiguracja UCI (network/wireless/dhcp/system/firewall) + dane Archer C6
│   ├── store.js           # Stan: running/staged, staging zmian, reset, autoryzacja, trwałość (data/state.json)
│   └── status.js          # Dynamiczny status (uptime, RAM, dzierżawy DHCP, interfejsy, Wi-Fi)
├── public/
│   ├── index.html         # Powłoka SPA (login + aplikacja)
│   ├── css/luci.css        # Motyw ciemny LuCI
│   ├── js/
│   │   ├── api.js         # Klient REST
│   │   ├── ui.js          # Budowanie UI w stylu CBI (formularze, tabele, walidacja, toasty, modale)
│   │   ├── pages.js       # Strony: Status, Interfejsy, Wi-Fi, DHCP, VLAN, System, Reset, Pomoc
│   │   └── app.js         # Router (hash), menu, logowanie, motyw
│   └── img/               # Logo / favicon (SVG)
└── data/state.json        # Zapisany stan (tworzony automatycznie)
```

### REST API (skrót)

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| POST | `/api/login` | Logowanie (zwraca token) |
| POST | `/api/logout` | Wylogowanie |
| GET | `/api/status/overview` | Status systemu |
| GET | `/api/status/{interfaces,wireless,leases}` | Status szczegółowy |
| GET/PUT | `/api/config/{network,wireless,dhcp,system,firewall}` | Odczyt / zapis sekcji (stage) |
| POST | `/api/apply` | Zastosuj zmiany (running ← staged) |
| POST | `/api/revert` | Cofnij niezapisane zmiany |
| GET | `/api/changes` | Lista niezapisanych zmian |
| POST | `/api/reset` | Reset fabryczny |
| POST | `/api/password` | Zmiana hasła |
| GET/POST | `/api/backup` `/api/restore` | Kopia zapasowa / przywracanie |

## Uwaga merytoryczna

OpenWrt w rzeczywistości używa numeracji typu `23.05`, `24.10` (a `5.12.1` to wersja
**jądra Linux**). Ciąg „OpenWrt 5.12.1” został użyty w nagłówku **zgodnie z poleceniem**;
w razie potrzeby zmień go w `lib/defaults.js` (pole `FIRMWARE.version`).

## Licencja

MIT — do dowolnego użytku edukacyjnego.
