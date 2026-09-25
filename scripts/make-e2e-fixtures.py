"""Builds the small GTNH-shaped archives used by src/main/e2e (see README).

Usage: python scripts/make-e2e-fixtures.py <output-directory>
Creates base.zip (original old version), new.zip (new version) and old-server.zip
(the old installation after user changes, with a world and world data).
"""
import sys
import zipfile
from pathlib import Path

SERVERUTILITIES = """backups {
    S:additional_backup_files <
        journeymap/data/sp/$WORLDNAME/**
        TCNodeTracker/$WORLDNAME/**
        saves/NEI/local/$WORLDNAME/**
        visualprospecting/server/$WORLDNAME_*/**
     >
}
"""

A_CFG = ["# A config", "general {", "  alpha=1", "  beta=2", "  gamma=3", "  delta=4", "  epsilon=5", "}"]

# Mods rewrite their configuration at every start: comments are reworded and new options appear
# with their default value, while the settings themselves stay the same.
REGENERATED_BASE = """general {
    # Enable the thing [default: true]
    B:enabled=true
}
"""
REGENERATED_OLD = """general {
    # Enable the thing, reworded by the mod [default: true]
    B:"enabled"=true

    # Added by the mod [default: false]
    B:newOption=false
}
"""

BASE = {
    "config/a.cfg": "\n".join(A_CFG) + "\n",
    "config/b.cfg": "b=1\n",
    "config/regenerated.cfg": REGENERATED_BASE,
    "config/unchanged.cfg": "u=1\n",
    "config/removed-later.cfg": "r=1\n",
    "config/binary.dat": b"BIN\x00v1",
    "mods/m1.jar": b"jar-v1",
    "server.properties": "level-name=World\nmotd=v1\nmax-players=20\n",
    "whitelist.json": "[]\n",
    "serverutilities/serverutilities.cfg": SERVERUTILITIES,
    "startserver.sh": "#!/bin/sh\njava -jar forge.jar\n",
    # Untouched configs keep the share of user changes realistic (no original-archive warning).
    **{f"config/untouched/mod{index:02}.cfg": f"setting={index}\n" for index in range(20)},
}

NEW = {
    **{key: value for key, value in BASE.items() if key not in ("config/removed-later.cfg", "mods/m1.jar")},
    "config/a.cfg": "\n".join(A_CFG[:6] + ["  epsilon=50", "}"]) + "\n",
    "config/c.cfg": "c=1\n",
    "config/binary.dat": b"BIN\x00v2",
    "mods/m2.jar": b"jar-v2",
    "server.properties": "level-name=World\nmotd=v2\nmax-players=20\n",
}

OLD_SERVER = {
    **BASE,
    "config/a.cfg": "\n".join(A_CFG[:2] + ["  alpha=10"] + A_CFG[3:]) + "\n",
    "config/b.cfg": "b=2\n",
    "config/removed-later.cfg": "r=2\n",
    "config/user-added.cfg": "mine=1\n",
    # Additions under serverutilities/ are carried over; the one above is recreated by its mod.
    "serverutilities/server/ranks.txt": "admin: Player\n",
    "config/binary.dat": b"BIN\x00mine",
    "config/regenerated.cfg": REGENERATED_OLD,
    "server.properties": "level-name=MyWorld\nmotd=my server\nmax-players=20\n",
    "whitelist.json": '[{"uuid":"00000000-0000-0000-0000-000000000001","name":"Player"}]\n',
    "logs/latest.log": "log line\n",
    "mods/custom.jar": b"custom-jar",
    "MyWorld/level.dat": b"\x0a\x00\x00level",
    "MyWorld/region/r.0.0.mca": bytes(range(256)) * 64,
    "MyWorld/serverutilities/players.dat": b"players",
    "OldWorldBackup/level.dat": b"old",
    "visualprospecting/server/MyWorld_0_overworld/data.bin": b"vp-data",
    "TCNodeTracker/MyWorld/nodes.dat": b"nodes",
}


def write(path: Path, entries: dict) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content.encode("utf-8") if isinstance(content, str) else content)


if __name__ == "__main__":
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    write(output / "base.zip", BASE)
    write(output / "new.zip", NEW)
    write(output / "old-server.zip", OLD_SERVER)
    print(output)
