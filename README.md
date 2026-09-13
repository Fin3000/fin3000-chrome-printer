# Fin3000 Chrome-Drucker

Rechnungen und Belege direkt aus Google Chrome an [Fin3000.com](https://fin3000.com) senden.

Mit **„An Fin3000 senden“** überträgst du Dokumente aus der Chrome-Druckvorschau
in deinen Fin3000-Belegeingang – ohne sie vorher herunterzuladen und manuell
hochzuladen.

## So funktioniert es

1. Öffne die Erweiterung und wähle **Mit Fin3000 verbinden**.
2. Melde dich an und bestätige den Zugriff auf dein Fin3000-Konto.
3. Öffne eine Rechnung oder einen Beleg in Chrome und wähle **Drucken**.
4. Wähle als Druckziel **An Fin3000 senden** und bestätige den Druck.
5. Prüfe die Übernahme im Erweiterungs-Popup und deinen Belegeingang in Fin3000.

Du benötigst Google Chrome und ein Fin3000-Konto mit freigeschalteter Druckfunktion.

[Zum Chrome Web Store](https://chromewebstore.google.com/detail/nchhenonjehkpmjmekbmeciififfaaem)
· [Hilfe](https://fin3000.com/hilfe/)
· [Datenschutz](browser-extension/PRIVACY.md)

## Gut zu wissen

- Gesendet wird die von Chrome erzeugte PDF-Druckdarstellung, nicht die Originaldatei.
- Eingebettete E-Rechnungsdaten, Signaturen und Anhänge können beim Drucken verloren
  gehen. Lade die Originaldatei direkt in Fin3000 hoch, wenn du diese Daten benötigst.
- Die maximale Dateigröße beträgt 20 MiB.
- Zeigt das Popup **Übernahme wird geprüft**, warte auf das Ergebnis, bevor du
  dasselbe Dokument erneut sendest.

## Selbst bauen

Voraussetzungen: Node.js 22 oder neuer und `zip`.

```bash
git clone https://github.com/Fin3000/fin3000-chrome-printer.git
cd fin3000-chrome-printer
npm ci
npm run extension:typecheck
npm run extension:test
npm run extension:build:prod
```

Das Entwicklerpaket liegt unter `dist/browser-extension/production/unpacked/`.
Öffne `chrome://extensions`, schalte den Entwicklermodus ein und wähle
**Entpackte Erweiterung laden**. Wähle anschließend diesen Ordner aus.
Lade das Entwicklerpaket nicht gleichzeitig mit der Store-Version derselben
Erweiterung.

Auch ein selbst gebautes Paket benötigt für die Anmeldung und das Senden ein
Fin3000-Konto mit freigeschalteter Druckfunktion.

## Entwicklung

- `browser-extension/`: Erweiterung, Sprachkataloge und Build-Profile.
- `scripts/`: Build-, Test- und Diagnosewerkzeuge.
- `public/images/`: Icons und Grafiken.

Mit `npm run extension:repro:prod` lässt sich die Reproduzierbarkeit des
Produktionspakets prüfen. Weitere technische Informationen findest du in der
[Entwicklerdokumentation](browser-extension/README.md).

Fehler und Verbesserungsvorschläge kannst du als
[GitHub-Issue](https://github.com/Fin3000/fin3000-chrome-printer/issues) melden.
Bitte veröffentliche dabei keine Rechnungen, persönlichen Daten oder Zugangsdaten.

## Lizenz

[Apache-2.0](LICENSE). Hinweise zu enthaltenen Drittanbieterkomponenten stehen in
[NOTICE](NOTICE). Die Marke Fin3000 ist nicht Teil der Lizenz.
