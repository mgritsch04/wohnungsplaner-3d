#!/usr/bin/env bash
# Legt die Labels des Issue-Ablaufs an bzw. gleicht Farbe und Beschreibung an
# (docs/DEVELOPMENT_WORKFLOW.md › „Labels“). Idempotent; braucht die GitHub-CLI `gh`.
# Aufruf: scripts/setup-labels.sh [owner/repo]
set -euo pipefail
repo="${1:-mgritsch04/wohnungsplaner-3d}"

label() { gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force; }

# Status (je Issue genau eines)
label "idea-inbox"     "c5def5" "Neue Idee, noch nicht übernommen"
label "planned"        "bfd4f2" "Geprüft und in docs/IDEAS.md aufgenommen"
label "in-progress"    "fbca04" "Wird umgesetzt"
label "auto-user-test" "006b75" "Wird automatisch getestet"
label "user-test"      "0e8a16" "Manuelle Prüfung durch G offen"
label "needs-fix"      "d93f0b" "User-Test fehlgeschlagen"
label "done"           "ededed" "Vollständig abgeschlossen"
label "user-task"      "5319e7" "[AUFGABE]: ein Thread braucht etwas von G"

# Zusatzlabels
label "priority: high" "b60205" "Blocker oder dringend, vor neuen Ideen"
label "info"           "1d76db" "Erledigt, enthält eine wichtige Info für G"
label "blocked"        "000000" "Offensichtlich blockiert"
