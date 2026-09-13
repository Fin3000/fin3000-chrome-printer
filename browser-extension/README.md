# Fin3000 Chrome-Druckziel

Die Chrome-Erweiterung erscheint in der normalen Druckvorschau als
**„An Fin3000 senden“**. Nach einer einmaligen Verbindung mit dem
Fin3000-Owner-Konto wird die von Chrome erzeugte PDF-Druckdarstellung direkt
in die bestehende, owner-scoped Belegquarantäne übernommen. Eine Owner-E-Mail
oder ein Portalzugriff ist nicht erforderlich.

## Lokaler QA-Quickstart

Voraussetzungen sind Node.js `22.22.3`, Chrome/Chromium ab Major `145` und die
normal installierten Backend-/Frontend-Abhängigkeiten. Drei Terminals verwenden
denselben Slug:

```bash
# Terminal 1 — isoliertes Backend einschließlich Worker und festem OAuth-Client
cd /home/sascha/dev/fin3000/workingtree/backend/chrome-print-to-fin3000
QA_SLUG=chrome-print bash scripts/qa_server.sh --fresh --worker --clamd-stub

# Terminal 2 — isoliertes Angular-Frontend für Login, 2FA und Consent
cd /home/sascha/dev/fin3000/workingtree/frontend/chrome-print-to-fin3000
QA_SLUG=chrome-print npm run qa

# Terminal 3 — validiertes unpacked Artefakt
cd /path/to/fin3000-chrome-printer
QA_SLUG=chrome-print npm run extension:doctor
QA_SLUG=chrome-print npm run extension:build:qa
```

Der letzte Befehl endet mit `Status: READY` und nennt den absoluten
`Load unpacked`-Pfad. Diesen Ordner unter `chrome://extensions` bei aktiviertem
Entwicklermodus über **Entpackte Erweiterung laden** auswählen. Danach:

1. Erweiterungssymbol anklicken und **Mit Fin3000 verbinden** wählen.
2. Login, gegebenenfalls 2FA und den Browser-Druck-Consent bestätigen. Das
   Popup muss den richtigen Kontonamen anzeigen.
3. `browser-extension/fixtures/hello-world.pdf` in Chrome öffnen, `Strg+P`,
   Ziel **An Fin3000 senden** und **Drucken** wählen.
4. Erst die Meldung „Dokument sicher bei Fin3000 eingegangen“ gilt als Erfolg.

Wenn die Quarantäne eine andere exakte S3-Origin liefert, wird sie nur für den
lokalen Build gesetzt:

```bash
FIN3000_EXTENSION_UPLOAD_ORIGINS=https://exakte-quarantaene.example \
QA_SLUG=chrome-print npm run extension:build:qa
```

## Store-ID-QA vor der Veröffentlichung

Für die reale Portalabnahme wird dieselbe reservierte Identität wie im
Web-Store-Draft mit den isolierten QA-Endpunkten kombiniert:

```bash
QA_SLUG=chrome-print npm run extension:build:store-id-qa
```

Das Ergebnis liegt ausschließlich unter
`dist/browser-extension/store-id-qa/`, enthält die Datei
`NOT_FOR_STORE.txt` und meldet `Distribution: NOT_FOR_STORE`. Es verwendet
den Produktions-Public-Client, darf nur gegen einen entsprechend gestarteten
isolierten QA-Stack geladen und niemals in den Chrome Web Store hochgeladen
werden.

## Diagnose und Tests

```bash
npm run extension:typecheck
npm run extension:test
npm run extension:inspect -- dist/browser-extension/qa/unpacked
QA_SLUG=chrome-print npm run extension:repro:qa
```

`extension:doctor` prüft feste ID, OAuth-Redirect, 26 Locale-Kataloge,
Node/Chrome und optional die erreichbaren OAuth-Metadaten. Der Build prüft
zusätzlich minimale Rechte, exakte Origins, Key→ID, fehlende Source Maps und
Portal-/Cookie-Code. Fehler folgen `CODE: Problem. Ursache. Nächster Schritt`.

Der separat erhaltene G1-Technikprobe bleibt mit diesen Befehlen reproduzierbar:

```bash
npm run extension:g1:doctor
npm run extension:g1:build
FIN3000_CHROMIUM_NO_SANDBOX=1 npm run extension:g1
```

## Sicherheits- und Datenvertrag

- Keine `content_scripts`, Portal-Hosts, Tabs-, Cookie- oder WebRequest-Rechte.
- Das PDF stammt ausschließlich aus dem bewusst ausgelösten Chrome-Druckjob.
- Fin3000-Tokens gehen nur an die feste API-Origin; PDF und signierte
  Formularfelder nur an die exakt erlaubte Quarantäne-Origin.
- Lokal gespeichert werden Tokens im auf vertrauenswürdige Extension-Kontexte
  begrenzten `storage.local`, der sichtbare Kontoname sowie opake Vorgangs-IDs
  und Zustände. Keine PDF-Bytes, Portal-URL, Cookies, S3-URL oder Dateinamen.
- Erfolg wird erst nach `custody=stored_isolated` und `acceptedAt` an Chrome
  gemeldet. Bei unklarem Uploadausgang fordert die Erweiterung ausdrücklich
  dazu auf, nicht erneut zu senden, und gleicht nur opake IDs ab.
- Die Druckdarstellung ist nicht zwingend das Originaldokument. Eingebettete
  E-Rechnungsdaten, Signaturen oder Anlagen können beim Drucken verloren gehen;
  dafür bleiben Datei-Upload und Fin3000-E-Mail maßgeblich.

Mehr dazu: [Datenschutz](PRIVACY.md), [Store-Text und Rechte](STORE_LISTING.md)
und [Support-/Betriebsrunbook](SUPPORT.md).

## Produktionsartefakt

Die Chrome-Web-Store-Identität wurde am 1. September 2026 im bestehenden,
nicht veröffentlichten Draft reserviert. Dieser Draft bleibt der kanonische
Store-Artikel und darf nicht durch einen neuen Artikel ersetzt werden:

- Extension-ID: `nchhenonjehkpmjmekbmeciififfaaem`
- OAuth-Redirect:
  `https://nchhenonjehkpmjmekbmeciififfaaem.chromiumapp.org/`
- Public Client: `fin3000-chrome-print`

Der öffentliche Manifest-Key und die exakte Quarantäne-Origin liegen im
eingecheckten `config/production.template.json`. Für einen Produktionscheck
ist kein weiterer Store-Upload nötig:

```bash
npm run extension:build:prod
npm run extension:verify:prod
npm run extension:repro:prod
```

Keiner dieser Befehle lädt etwas hoch oder veröffentlicht im Store.
`extension:bootstrap:prod` bleibt ausschließlich ein Recovery-Werkzeug und
darf nicht zum Anlegen eines zweiten Store-Artikels verwendet werden.
