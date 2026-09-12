# Support- und Betriebsrunbook

## Nutzerdiagnose

1. Im Popup kontrollieren, ob **Verbunden mit <Kontoname>** das richtige
   Fin3000-Konto zeigt.
2. Bei **Nicht verbunden** neu verbinden und den Druck danach erneut auslösen.
3. Bei **Das Dokument wurde nicht gesendet** ist ein neuer Druck sicher.
4. Bei **Übernahme wird geprüft** nicht erneut senden; Popup geöffnet lassen
   oder Chrome später neu starten, damit Fin3000 die opaken IDs abgleicht.
5. Bei einer Datei über 20 MiB den bestehenden Fin3000-Datei-Upload oder die
   Fin3000-E-Mail verwenden.

Supportberichte dürfen nur Chrome-Version, Extension-Version, sichtbaren
kategoriellen Status und Zeitpunkt enthalten. Keine Screenshots oder Logs mit
Rechnungsinhalt, Kontonamen, Tokens, Vorgangskennungen, Portal- oder S3-URLs.

## Maintainerdiagnose

```bash
QA_SLUG=chrome-print npm run extension:doctor
QA_SLUG=chrome-print npm run extension:build:qa
npm run extension:inspect -- dist/browser-extension/qa/unpacked
```

Bei `EXTENSION_ID_DRIFT` stimmen Manifest-Key, Chrome-ID und OAuth-Redirect
nicht überein. Bei `HOST_PERMISSION_BROAD` darf das Artefakt nicht verteilt
werden. `QA_VALUE_IN_PROD` bedeutet nach der Store-ID-Reservierung, dass wieder
ein Platzhalter oder QA-Wert in das Produktionsprofil gelangt ist. In diesem
Fall bleibt der Release blockiert und `npm run extension:verify:prod` nennt
die fehlerhafte Grenze.

## Widerruf und Kill-Switch

- Nutzerwiderruf: Popup → **Verbindung trennen**. Lokal wird immer gelöscht;
  die serverseitige Revocation ist best effort.
- Kontowechsel: Verbindung trennen und bewusst neu verbinden. Ein anderer
  opaker Principal kann alte Vorgangs-IDs nicht abfragen.
- Operativer Kill-Switch: Backend `BROWSER_PRINT_ENABLED=False`. Die schmalen
  Intake-Routen antworten danach ohne Serverwirkung mit 503, und neue OAuth-
  Grants/Refreshs für den festen Client werden abgelehnt.
- Distribution: Store-Veröffentlichung pausieren oder zurückziehen. Das ersetzt
  nicht den Backend-Kill-Switch.
- Niemals als Notfall-Fallback Portal-Cookies, Scraping, breite Hostrechte oder
  automatischen E-Mail-Versand aktivieren.

Vor einer erneuten Freigabe: Backendchecks, gezielte OAuth-/Intake-Tests,
Extensiontests, reproduzierbarer Build, Manifestinspektion sowie synthetischer
Custody-Canary. Reale Portalclaims werden zusätzlich im jeweiligen Portal
manuell über die Chrome-Druckvorschau geprüft.
