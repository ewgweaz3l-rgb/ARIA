STAR CITIZEN GAME FILES FOR KEYBINDS
====================================

ARIA always reads YOUR changed keybinds straight from the game install
(...\StarCitizen\LIVE\user\client\0\Profiles\default\actionmaps.xml).

To also know EVERY action, its default key and its proper name, drop these
two files in this folder. They live inside the game's Data.p4k archive:

  defaultProfile.xml   Data\Libs\Config\defaultProfile.xml
  global.ini           Data\Localization\english\global.ini

Extract them with the community tool unp4k (search "unp4k github"), e.g.
  unp4k.exe "C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Data.p4k" defaultProfile.xml
  unp4k.exe "C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Data.p4k" global.ini

Re-extract after big patches; bindings and action names change between versions.
Without these files ARIA uses a small starter list plus your own changed binds.
