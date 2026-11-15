# Schrijfkamer: overdracht voor wie hierop verder bouwt

Schrijfkamer is een app om boeken te plannen en te schrijven: manuscript per hoofdstuk, plot, personages, wereld, ideeën, voortgang en publicatie. Ze is gemaakt voor Robin. Robin schrijft Engelstalige romans, zoals *Strangers* en *Rise of the Shadows*, op basis van roleplay-tekst uit chat-apps. Robins zus gebruikt de app voor haar eigen boeken, met een eigen account.

- **Taal met de gebruiker:** altijd Nederlands. De UI is ook Nederlands.
- **Toon:** Robin wil een adviseur, geen ja-knikker. Benoem fouten en risico's eerst, zonder loze lof, en geef zekerheid aan met [Certain], [Likely] of [Guessing].
- **Repository:** `robinbollens-commits/schrijfkamer` (openbaar, nodig voor de auto-update).
- **Huidige release:** 1.8.4. Account-sync via Firebase staat aan; er is een Android-app.

## Stand van zaken

**Af en uitgebracht t/m 1.7.0** (door de gebruiker getest en goed bevonden, de update-knop inbegrepen):

- Zoeken en vervangen ("vervang alles", ook voor namen).
- Herschrijfmodus:
  - Het origineel staat naast de editor.
  - Er zijn versies, met dropdowns "Vergelijk met" links en "Werk aan" rechts.
  - Je kunt passages afvinken als klaar, zonder dat de pagina terugspringt.
- Taal per boek, ook in te stellen bij Instellingen. De spellingcontrole gebruikt meegeleverde woordenboeken.
- Updates met één klik vanuit de app, via GitHub Releases.
- Een 60-hoofdstukkenstructuur als plothulp.
- Het venster volgt de cursor tijdens het typen.
- Afbeeldingen openen groot (lightbox) of in een apart venster.
- Hoofdstukken:
  - Je kunt een hoofdstuk tussenvoegen na het huidige.
  - Je kunt passages uit een ander hoofdstuk meenemen naar een nieuw hoofdstuk.
- "Naslag"-tabbladen naast je tekst: andere hoofdstukken, personages, wereld, plot en ideeën.
- Een inklapbaar linkermenu.
- Sync via een cloudmap, zoals Google Drive voor computers (1.6.0, `sync.js`).

**1.8.x (gebouwd in de lokale sessie op Robins pc):**

- **1.8.0:** account-sync aan. `firebase-config.json` staat in de root, voor project `schrijfkamer-ec48b`. De webversie staat op https://robinbollens-commits.github.io/schrijfkamer/.
- **1.8.1:** het inlogscherm wacht tot `<body>` bestaat. Eerder bleef de app soms hangen op "wordt geopend".
- **1.8.2:** opslagmeter voor de beheerder (Instellingen → Account). Elke app schrijft alleen getallen naar `data/usage/accounts/<uid>`; de regels staan in FIREBASE.md.
- **1.8.3:** afbeeldingen boven 200 kB worden verkleind voor ze naar het account gaan: WebP, max. 1600 px, ~300 kB; GIF blijft ongewijzigd. Op de desktop blijft het origineel lokaal.
- **1.8.4:** Android-app in `android/`, pakket `be.robin.schrijfkamer`.
  - Het is een eigen WebView-app die de online webversie laadt. Updates van de webversie komen dus vanzelf; een nieuwe APK is alleen nodig als `android/` verandert.
  - De app regelt bestanden kiezen, back-ups bewaren naar Downloads/Schrijfkamer, de terugknop en externe links.
  - `build.yml` hangt `Schrijfkamer-<versie>.apk` aan elke release, als de repository-geheimen `ANDROID_KEYSTORE_B64` en `ANDROID_KEYSTORE_PASSWORD` bestaan.
  - De SHA-256 van de signeersleutel wordt gecontroleerd. **De keystore staat niet in git. Zonder die sleutel installeert een nieuwe APK niet als update.**
    - De sleutel staat in `android/keystore/` en `android/keystore.properties` op Robins pc.
    - Een kopie staat op `\\RBNas\Apps And Projects\Schrijfkamer\Signeersleutel Android`.
    - De vingerafdruk begint met `47:BB:A7:31`.
  - `versionCode` is (versie als getal × 100) + `ANDROID_REV` in `android/app/build.gradle.kts`. Verhoog `ANDROID_REV` als de APK verandert zonder een nieuwe webversie.
  - `web-shim.js` geeft downloads aan de app door via `window.SchrijfkamerAndroid`, een `WebMessageListener` die alleen berichten van de eigen origin aanneemt. De app bewaart ze in `Downloads/Schrijfkamer`.
  - De webinhoud is alleen in debug-builds inspecteerbaar (chrome://inspect).
  - **Geschiedenis:** eerst was het een Trusted Web Activity. Op Robins gsm toonde die toch een adresbalk, en Robin wilde een volledige app zoals zijn Jarvis-app. Uit die periode stamt de repo `robinbollens-commits.github.io`, met `.well-known/assetlinks.json` (nu niet meer nodig) en een `index.html` die doorverwijst naar `/schrijfkamer/`.

**Nagekeken op 15/11/2026 (lokale sessie):**

- **Robins eerste login** gebeurde op de desktop met 1.8.1. De 4 boeken (326 documenten) staan online, en 16 van de 17 afbeeldingen gingen meteen mee.
  - De wereldkaart (JPG van 4800 px, 4,9 MB) bleef toen lokaal, omdat ze boven ~740 kB zat. Ze is daarna online gezet als JPEG van 1600 px (611 kB), op Robins keuze. Op de desktop staat het origineel nog.
- **De zus heeft nog geen account.** Op 15/11 bestond alleen Robins account.
- **Het beheerder-e-mailadres staat in de gepubliceerde Firestore-regels.** Het repo-bestand `firebase/firestore.rules` bevat de plaatshouder `JOUW-EMAILADRES`.
  - **Publiceer dat bestand nooit ongewijzigd naar `schrijfkamer-ec48b`.** Dan verliest Robin de opslagmeter. Vul eerst zijn e-mailadres in, en zet dat niet in git.
- **De Android-app** (WebView, 1.8.4) is geïnstalleerd op Robins gsm en werkt. Robins volgende wens: de interface beter maken voor gebruik op de gsm.

**Waarschuwingen:**

- De boeken op claude.ai (de oude artifact-versie) staan los van alles. Wil Robin die online, dan eerst daar een back-up exporteren en die importeren.
- De zus logt in met een eigen account. Haar lokale boeken gaan naar háár account.

## Architectuur

**Eén app in drie vormen:**

- **Bron:** `src/schrijfkamer.html`, één groot HTML-bestand met alle UI en logica.
  - Oorspronkelijk was het een claude.ai-artifact. Die versie (artifact-versie 24) is identiek aan dit bestand, maar wordt niet meer bijgewerkt. Werk vanaf nu rechtstreeks in `src/schrijfkamer.html`.
  - De app praat alleen met `window.claude.use('db'|'user'|'downloads'|'assets'|'sample')`, de artifact-API. Houd die interface intact; de shims hieronder vullen ze in.
  - Top-level `const S` is de app-state. In tests: `typeof S !== 'undefined'`, want `window.S` bestaat niet.
- **Desktop (Electron 44.5.1):** `scripts/build-renderer.js` maakt `renderer/` (in .gitignore).
  - Het script haalt externe fonts weg en zet lokale @fontsource-fonts in de plaats.
  - Het zet een strikte CSP met sha256-hashes van de inline scripts.
  - Het vervangt AI-teksten die naar "Claude" verwijzen door neutrale teksten.
  - Het voegt de shim-scripts toe.
- **Web/PWA:** `node scripts/build-renderer.js --web` maakt `web/`, met manifest, iconen, service worker (`src/sw.js`) en `web-shim.js`.

| Bestand | Rol |
|---|---|
| `main.js` | hoofdproces: venster, `app://schrijfkamer`-protocol (serveert `renderer/` en `/_blob/<id>`), opslag in één JSON-bestand, dagelijkse reservekopieën (14 bewaard), spellcheck, afbeeldingsvenster, menu, IPC |
| `preload.js` | `window.desktop` via contextBridge: `store`, `assets`, `files`, `ai`, `sync`, `images`, `spell`, `update`, `version` |
| `src/desktop-shim.js` | `window.claude.use(...)` bovenop `window.desktop`; in cloudmodus: login, migratie, spiegel naar het lokale bestand, afbeeldingen uit de cloud |
| `src/cloud.js` | Firebase (compat-UMD 12.19.0): login-overlay (NL-foutmeldingen, account maken, wachtwoord vergeten), `dbApi`, `assetPut/Get/Del`, `migrate`, `summary`, `signOut`; ondersteunt de emulator |
| `src/web-shim.js` | dezelfde brug voor de browser; migreert ook uit localStorage `schrijfkamer:data:v1` |
| `src/sw.js` | app-shell-cache, `_blob/<id>`-cache |
| `ai.js` | Claude (`@anthropic-ai/sdk` 0.129.0, `client.beta.messages.stream`, server-side fallback, effort medium; geen fallbacks of effort voor Haiku), Ollama (`/api/chat`, `num_ctx`), OpenAI-compatibel (LM Studio enz.) |
| `updater.js` | electron-updater 6.8.10, `autoDownload=false`; één klik = downloaden → installeren → herstarten |
| `android/` | Android-app (Kotlin, `MainActivity.kt` met een WebView op de Pages-URL); bouwen met `gradlew assembleRelease`, de keystore in `android/keystore/` staat niet in git |
| `sync.js` | map-sync: één bestand per document in `<map>/Schrijfkamer/docs`, poll elke 4 s, aanwezigheidsbestanden, offline wachtrij, conflictkopieën |

**Gegevens in Firebase:**

- Documenten staan onder `data/users/<uid>/library/...`; afbeeldingen als base64 onder `data/users/<uid>/library/assets/<id>`.
- Maximaal ~740 KB per afbeelding. Sinds 1.8.3 wordt alles eerst verkleind, zodat ook grote foto's meegaan.
- De regels (`firebase/firestore.rules`) laten elke gebruiker alleen in `data/users/{zijnUid}/**`.
- **Opslagmeter (1.8.2):**
  - `cloud.js` meet elk account één keer per halve dag. Het is een schatting volgens de Firestore-rekenregels, de indexen inbegrepen.
  - Alleen de getallen gaan naar `data/usage/accounts/<uid>`.
  - De grootte van elke afbeelding staat in de map `assetSizes` op het document `data/users/<uid>/library`. Zo hoeft de meter geen afbeeldingen te downloaden. `assetPut` en `assetDel` houden die map bij.
  - Lezen van alle accounts mag alleen het beheerder-e-mailadres, en dat staat alleen in de gepubliceerde regels. De app toont de meter alleen als dat lezen lukt; het e-mailadres staat dus niet in de openbare code.
- **Gratis Spark-limiet:** 1 GiB voor alle accounts samen.

## Back-ups (buiten de repo, op Robins pc)

Robin wil de NAS **niet** als cloudopslag voor de app, alleen als lokale back-up. Er draaien twee geplande Windows-taken. De scripts staan in `C:\AI waifu\nas-backup\`, de logs in `nas-backup\logs\`.

| Taak | Wat |
|---|---|
| "Schrijfkamer reservekopieën naar NAS" (20:00) | `schrijfkamer-naar-nas.ps1`: robocopy van `%APPDATA%\Schrijfkamer\reservekopieen` naar `\\RBNas\Apps And Projects\Schrijfkamer\Reservekopieen`; verwijdert niets op de NAS |
| "Schrijfkamer Firebase-back-up naar NAS" (20:15) | `firebase-backup.js`: alle accounts naar `...\Schrijfkamer\Firebase-backup\<datum>\` |

De Firebase-back-up maakt per dag:

- `database.json`: alle documenten;
- `accounts.json`: de accounts, **zonder** wachtwoord-hashes (Robins keuze);
- per account `<e-mail>.schrijfkamer.json`, in het formaat van "Back-up exporteren", dus terug te zetten via Instellingen → Back-up importeren.

Bewaring en veiligheid:

- Bewaard worden de laatste 30 dagen plus de eerste back-up van elke maand.
- Krimpt het aantal documenten met meer dan 30%, dan volgt een waarschuwing en wordt er niets opgeruimd.
- Het script logt in met het serviceaccount `schrijfkamer-backup`, dat alleen mag lezen (`roles/datastore.viewer` en `roles/firebaseauth.viewer`). De sleutel staat in `%USERPROFILE%\.schrijfkamer-backup\sleutel.json`.

Projectbestanden horen op de NAS in `\\RBNas\Apps And Projects\Schrijfkamer\` (met een LEESMIJ.txt), niet bij de foto's in `\\RBNas\Robbol Photography`.

**Eerste login (migratie), zo dat er niets verloren gaat:**

1. Eerst een reservekopie: `voor-account`.
2. Dan per document:
   - ontbreekt het online, dan gaat het online;
   - is het identiek, dan wordt het overgeslagen;
   - verschillen de twee, dan wint de nieuwste `updated`, en de verliezer gaat naar de reservekopie `verschillen-bij-account`.
3. De lokale data wordt "geclaimd": `localStorage['schrijfkamer:cloud-owner'] = uid`.
4. Logt op die computer daarna een ánder account in, dan wordt het lokale bestand niet gespiegeld. Zo mengen de boeken van Robin en de zus nooit.
5. De map-sync gaat automatisch uit zodra een account actief is.

## Bouwen, testen, uitbrengen

```bash
npm install
npm start                               # bouwt renderer/ en start de app
node scripts/build-renderer.js --web    # webversie in web/
npm run dist                            # Windows-installer (op Windows)
```

**Uitbrengen:**

- Verhoog `version` in `package.json` en push naar `main`. `build.yml` (windows-latest, electron-builder 26.17.0, NSIS, niet ondertekend) maakt dan release `v<versie>` aan, met de .exe, de blockmap en `latest.yml`. Daarna hangt een tweede job de APK aan dezelfde release.
- Tags pushen hoeft niet. Push zonder versieverhoging geeft alleen een build-artefact.

**Valkuilen die al eens misgingen:**

- CRLF op Windows maakt de CSP-hash ongeldig: de app blijft hangen op "wordt geopend". Het buildscript normaliseert naar LF en `.gitattributes` helpt mee. Voeg je een inline `<script>` toe, dan rekent het buildscript de hash vanzelf mee.
- Spellcheck: Chromium downloadt geen woordenboeken. De `.bdic`-bestanden in `dictionaries/` gaan mee via extraResources en worden gekopieerd naar `<userData>/Dictionaries`.
- In een workflow-YAML geeft een onaangehaalde `: ` in een `run:`-regel "workflow file issue". Gebruik dan een block scalar (`|`).
- Firestore-documentpaden moeten een even aantal segmenten hebben, vandaar `library/assets/<id>`.
- De single-instance-lock moet ná `app.setPath` komen.

**Testen:**

- `SCHRIJFKAMER_DATA=<map>` laat de app een eigen datamap gebruiken; zo kunnen meerdere "computers" naast elkaar draaien.
- De end-to-end-tests draaiden met Playwright `_electron` in de cloud-sessie en zitten niet in de repo: ze gebruikten Robins privéboek als testdata, en de repo is openbaar.
- Die tests dekten:
  - herschrijven, zoeken en vervangen, de 60-structuur, tussenvoegen, naslag, lightbox, taal, caret, update en map-sync;
  - de account-sync: login verplicht, migratie zonder verlies, live sync tussen twee toestellen, de zus kan Robins data niet lezen (permission-denied), login blijft bewaard, PWA offline schrijven en later syncen.
- Firebase-emulator: `firebase/firebase.json` (auth 9099, firestore 8080), project `demo-schrijfkamer`:
  ```bash
  npx firebase-tools@15.34.2 emulators:start --project demo-schrijfkamer --config firebase/firebase.json
  SK_FIREBASE_CONFIG=firebase/emulator-config.json npm start
  ```
  De testconfig bevat `emulator`-velden. Zet die **nooit** als `firebase-config.json` in de root.

## Afspraken

- Geen persoonlijke gegevens of boekinhoud van Robin of de zus in de (openbare) repo.
- Er staat een `LICENSE`-bestand in de repo (alle rechten voorbehouden). Robin heeft de toevoeging ervan eigenlijk geweigerd, maar ze was al gepusht; Robin vroeg niet om het te verwijderen. Vraag het na als het ter sprake komt.
- Grote veranderingen eerst kort voorleggen. Robin test zelf op Windows en meldt problemen met een screenshot.
- Geheimen en sleutels vult Robin zelf in, zoals de GitHub-geheimen en zijn wachtwoord. Git-inloggegevens uitlezen om zelf naar de GitHub-API te uploaden wordt geweigerd. Laat GitHub Actions het doen, of laat Robin uploaden.
- Robin schrijft zijn boeken zelf. Bied geen AI-proza aan; feedback, ordenen en controles mogen wel.
