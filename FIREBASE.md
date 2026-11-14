# Account-sync instellen (Firebase)

Eenmalig, ± 10 minuten. Gratis: het Spark-abonnement van Firebase vraagt geen betaalkaart.
Daarna synchroniseren je pc, je laptop en je gsm, en kan je zus met een eigen account werken.
Niemand kan de boeken van een ander lezen.

## 1. Project maken
1. Ga naar **console.firebase.google.com** en log in met je Google-account.
2. **Project maken** (of *Een project toevoegen*). Naam: `schrijfkamer`. Google Analytics mag **uit**. Klik **Project maken**.

## 2. Inloggen met e-mail aanzetten
1. Links: **Build → Authentication → Aan de slag**.
2. Kies **E-mailadres/wachtwoord**, zet de **eerste** schakelaar aan, **Opslaan**.
3. Tabblad **Instellingen → Geautoriseerde domeinen → Domein toevoegen**: `robinbollens-commits.github.io`.
4. Optioneel: tabblad **Sjablonen**, taal van de e-mails op **Nederlands** (voor "wachtwoord vergeten").

## 3. Database maken
1. Links: **Build → Firestore Database → Database maken**.
2. Locatie: **europe-west1 (België)**. Start in **productiemodus**. **Maken**.
3. Tabblad **Regels**: vervang alles door het blok hieronder en klik **Publiceren**.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Elke gebruiker mag alleen zijn eigen Schrijfkamer lezen en schrijven.
    match /data/users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 4. De app registreren
1. Bovenaan links het tandwiel → **Projectinstellingen**.
2. Onderaan bij **Je apps**: klik het web-icoon **</>**. Bijnaam: `Schrijfkamer`. Hosting **niet** aanvinken. **App registreren**.
3. Je ziet een blok `const firebaseConfig = { apiKey: "...", authDomain: "...", ... };`
   Kopieer dat blok en stuur het naar Claude. Dit is geen geheim: het staat in elke webapp die Firebase gebruikt; de regels uit stap 3 beschermen je gegevens.

## 5. GitHub: de gsm-versie aanzetten
In je repository `schrijfkamer` op GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Daarna staat de gsm-versie op `https://robinbollens-commits.github.io/schrijfkamer/`.
Open die link op je gsm in Chrome, en kies **⋮ → App installeren** (of *Toevoegen aan startscherm*).

## Wat gebeurt er bij de eerste keer inloggen?
- De app maakt eerst een reservekopie van alles wat op dat toestel staat (map `reservekopieen`).
- Daarna gaan je boeken en afbeeldingen naar je account. Wat al online stond, wordt niet zomaar overschreven:
  bij een verschil wint de nieuwste versie en gaat de andere naar je reservekopieën.
- Je zus maakt in haar eigen app een eigen account aan; haar boeken gaan naar haar account.

## Gratis limieten (Spark)
1 GB opslag, 50.000 keer lezen en 20.000 keer schrijven per dag. Voor twee schrijvers ruim voldoende.
Afbeeldingen staan in de database zelf (de aparte bestandsopslag van Firebase is niet meer gratis); één afbeelding mag ± 700 kB zijn.
