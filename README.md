# Schrijfkamer

Een rustige plek om je boek te plannen, te schrijven en bij te houden: manuscript per hoofdstuk, plot, personages, wereld, ideeën, voortgang, publicatie en je auteurschap. Alles staat op je eigen computer. AI-hulp kan, maar hoeft niet.

## Installeren (Windows)

1. Ga naar **Releases** (rechts op deze pagina) en download `Schrijfkamer-Setup-x.y.z.exe`. De repository is privé: wie geen toegang heeft, krijgt het installatiebestand rechtstreeks doorgestuurd.
2. Dubbelklik op het bestand.
3. Windows toont waarschijnlijk een blauw scherm: *"Windows heeft uw pc beschermd"*. Dat komt doordat de app niet met een betaald certificaat is ondertekend, niet doordat er iets mis mee is. Klik op **Meer informatie** en dan op **Toch uitvoeren**.
4. Volg de installatie. Je krijgt een snelkoppeling op je bureaublad en in het startmenu.

De app start leeg. Je kiest dan zelf:

- **Begin aan een boek**: een nieuw, leeg boek.
- **Verken een voorbeeldboek**: een ingevuld boek om te zien hoe alles werkt (je kunt het daarna verwijderen).
- **Importeer een back-up**: je bestaande boeken uit de webversie of van een andere computer.

## Updates

De app zoekt zelf naar nieuwe versies: bij het opstarten en daarna om de zes uur. Is er een nieuwe versie, dan verschijnt linksonder **Update naar x.y.z**. Eén klik downloadt de update, installeert ze en start Schrijfkamer opnieuw. Je teksten worden eerst bewaard.

Dit werkt alleen als de repository openbaar is. Bij een privé-repository meldt de app dat er geen openbare updates te vinden zijn, en installeer je nieuwe versies zelf.

## Je gegevens

- Alles staat in `%APPDATA%\Schrijfkamer` (via *Instellingen → Gegevensmap openen*).
- Elke dag maakt de app automatisch een reservekopie van je teksten. De laatste veertien blijven bewaard, in de map `reservekopieen`. Afbeeldingen zitten daar niet in; die staan apart in `afbeeldingen`.
- **Volledige back-up** (*Instellingen* of *Boek → Back-up*): één `.json`-bestand met al je boeken, notities en afbeeldingen. Zet dat geregeld op een USB-stick of in je cloudmap. Met datzelfde bestand verhuis je je boeken naar een andere computer.
- Verwijderen van de app laat je gegevens staan.

Iedereen die de app installeert heeft een eigen, lege Schrijfkamer. Er gaat niets over het internet, behalve wanneer je zelf de Claude-API kiest.

## AI-hulp (optioneel)

Met AI krijg je “Wat schrijf ik hierna?”, een consistentiecheck per hoofdstuk, een ideeëngenerator, feedback na een schrijfsessie en voorstellen voor je marketingplan. Zonder AI werkt al de rest gewoon, en kun je nog altijd met **Kopieer context voor Claude** je verhaalbijbel in een Claude-chat plakken.

Kies bij *Instellingen → AI-hulp* een van deze drie:

### 1. Ollama: gratis, lokaal

1. Installeer Ollama van [ollama.com](https://ollama.com).
2. Open een terminal (PowerShell) en haal een model op, bijvoorbeeld `ollama pull qwen3:14b`.
3. Kies in Schrijfkamer **Ollama**, klik op *Geïnstalleerde modellen ophalen*, kies het model en klik op *Test verbinding*.

Welk model past, hangt vooral af van het geheugen van je videokaart (VRAM):

| VRAM | Probeer eerst | Alternatief |
|---|---|---|
| 8 GB | `qwen3:8b` | `llama3.1:8b` |
| 12–16 GB | `qwen3:14b` | `gemma3:12b` |
| 24 GB of meer | `gemma3:27b` | `qwen3:32b`, `mistral-small` |

Je verhaalbijbel en de hoofdstukken worden mee verstuurd. Daarom staat de contextlengte standaard op 16.384 tokens; Ollama zelf gebruikt standaard veel minder en zou dan stilletjes het begin van je boek weglaten. Wordt een vraag te lang, dan krijg je een melding en kun je de contextlengte hoger zetten (dat vraagt meer VRAM).

Eerlijk verwachtingspatroon: lokale modellen zijn bruikbaar voor ideeën en feedback, maar duidelijk zwakker dan Claude in het opsporen van tegenstrijdigheden over een heel boek. Ze geven ook vaker een antwoord dat de app niet kan lezen; probeer het dan opnieuw.

### 2. LM Studio of een andere lokale server

Kies **LM Studio (OpenAI-compatibel)**. In LM Studio: laad een model en start de server (tabblad *Developer*). Het adres is standaard `http://localhost:1234/v1`. Dit werkt ook met llama.cpp, Jan, KoboldCpp en andere servers die de OpenAI-API nabootsen.

### 3. Claude via een API-sleutel: betaald per gebruik, beste kwaliteit

1. Maak een account op [console.anthropic.com](https://console.anthropic.com), zet er tegoed op en maak een API-sleutel aan. Je gewone Claude-abonnement telt hier niet mee; dit is apart.
2. Kies **Claude**, plak de sleutel en kies een model. De sleutel wordt versleuteld op je computer bewaard (Windows DPAPI).

| Model | Prijs per miljoen tokens (in / uit) | Wanneer |
|---|---|---|
| Claude Opus 5.5 | $4 / $20 | beste kwaliteit, standaard |
| Claude Sonnet 5.5 | $2 / $10 | goed en goedkoper |
| Claude Haiku 5.5 | $0,10 / $0,50 | goedkoopst, minder sterk in lange teksten |

Een consistentiecheck van één hoofdstuk kost met Opus grofweg 10 à 15 cent.

## Voor wie eraan wil sleutelen

```bash
npm install
npm start          # bouwt renderer/ en start de app
npm run dist       # Windows-installer in dist/ (op Windows, of op Linux met wine)
```

De app zelf staat in `src/schrijfkamer.html`; dat is hetzelfde bestand als de webversie op claude.ai. `scripts/build-renderer.js` maakt er een desktopversie van: lokale lettertypes, een strikte CSP, de brug naar het hoofdproces (`src/desktop-shim.js`) en AI-neutrale teksten. Een nieuwe versie van de webapp overnemen:

```bash
npm run sync -- pad/naar/index.html
```

**Een nieuwe release maken:** verhoog `version` in `package.json` (bijvoorbeeld naar `1.0.1`), commit en push naar `main`. GitHub Actions bouwt de installer op Windows en maakt automatisch de release `v1.0.1` aan bij *Releases*. Push je zonder de versie te verhogen, dan wordt de installer wel gebouwd (als download onder die run in *Actions*), maar komt er geen nieuwe release.

| Bestand | Wat |
|---|---|
| `main.js` | hoofdproces: venster, opslag, afbeeldingen, reservekopieën, menu |
| `ai.js` | Claude, Ollama en OpenAI-compatibele servers |
| `updater.js` | automatische updates via GitHub Releases |
| `preload.js` | veilige brug tussen venster en hoofdproces |
| `src/desktop-shim.js` | vertaalt de opslag- en AI-aanroepen van de webapp naar de desktop |
