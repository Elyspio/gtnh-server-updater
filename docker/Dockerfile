# Linux build image that packages both targets: AppImage/deb natively, NSIS through wine.
FROM electronuserland/builder:wine

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    CI=true

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /work
