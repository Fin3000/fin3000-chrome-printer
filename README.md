# Fin3000 Chrome-Drucker

Öffentlicher Quellcode der Chrome-Erweiterung **„An Fin3000 senden“**:
Eine bewusst ausgelöste PDF-Druckdarstellung wird an den Belegeingang des
verbundenen Fin3000-Kontos gesendet.

Dieses eigenständige Repository enthält nur die Erweiterung und ihre
Build-/Testwerkzeuge, nicht die private Fin3000-Web-App oder deren Historie.
Der bestehende Chrome-Web-Store-Artikel bleibt unverändert:
[`nchhenonjehkpmjmekbmeciififfaaem`](https://chromewebstore.google.com/detail/nchhenonjehkpmjmekbmeciififfaaem).
Die Quellcodeveröffentlichung legt keinen neuen Store-Artikel an und führt
keinen Store-Upload durch.

## Selbst bauen

Voraussetzungen: Node.js 22.22.3 und `zip`.

```bash
git clone https://github.com/Fin3000/fin3000-chrome-printer.git
cd fin3000-chrome-printer
npm ci
npm run extension:typecheck
npm run extension:test
npm run extension:build:prod
npm run extension:repro:prod
```

Das entpackte Entwicklerpaket liegt unter
`dist/browser-extension/production/unpacked/`. Es lässt sich über
`chrome://extensions` → Entwicklermodus → „Entpackte Erweiterung laden“ testen.
Nicht gleichzeitig mit einer installierten Store-Version derselben ID laden.
Zum Verbinden wird ein berechtigtes Fin3000-Konto benötigt; ein erfolgreicher
Build allein prüft weder die Verfügbarkeit noch die Freigabe der API.
Für normale Nutzer ist die Store-Installation vorgesehen.

Die Erweiterungsversion bleibt **0.1.0**, der OAuth-Public-Client bleibt
`fin3000-chrome-print`. Der eingecheckte Manifest-Key ist ein öffentlicher
Identitätsschlüssel, kein Signier- oder Client-Geheimnis.

## Quellcode und lokale Tests

- `browser-extension/`: unveränderter Produktcode, 26 Sprachen und Profile.
- `scripts/`: eigenständige Build-, Prüf- und Diagnosewerkzeuge.
- `public/images/`: die für den Build benötigten Fin3000-Icons.

Die eingebettete [technische Dokumentation](browser-extension/README.md)
beschreibt auch interne isolierte QA-Stacks und historische Store-Vorbereitung.
Die dortigen Workspace-Pfade sind Beispiele aus der ursprünglichen Entwicklung,
keine zusätzlich öffentlichen Repositories. `extension:bootstrap:prod` ist ein
historisches Recovery-Werkzeug und für den normalen Build nicht erforderlich.

[Datenschutz](browser-extension/PRIVACY.md) ·
[Support](browser-extension/SUPPORT.md)

## Lizenz

Apache-2.0, siehe [LICENSE](LICENSE) und [NOTICE](NOTICE).
Die Lizenz erteilt keine Markenrechte und keinen Zugriff auf private
Fin3000-Dienste. Forks müssen ihre eigene OAuth-/Store-Identität verwenden;
Produktiv-Tokens oder private Schlüssel gehören niemals ins Repository.
