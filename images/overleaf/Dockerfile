# Extend upstream CE+ directly, including its bundled TeX Live installation.
ARG OVERLEAF_BASE_IMAGE
FROM golang:alpine AS cron
RUN CGO_ENABLED=0 go install github.com/aptible/supercronic@latest
FROM ${OVERLEAF_BASE_IMAGE}
USER root
ARG TARGETARCH
ARG KUBECTL_MINOR=1.35
ARG TEXLIVE_PACKAGES="collection-latexrecommended collection-fontsrecommended collection-latexextra collection-bibtexextra collection-xetex collection-luatex"
RUN tlmgr option docfiles 0 && tlmgr option srcfiles 0 && \
    tlmgr update --self && tlmgr install ${TEXLIVE_PACKAGES} && tlmgr path add
# Install the native tools required for fonts and optional document conversion.
RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/ubuntu.sources && \
    apt-get update && apt-get install -y --no-install-recommends fontconfig pandoc zip rsync curl ca-certificates && \
    cp "$(kpsewhich -var-value TEXMFSYSVAR)/fonts/conf/texlive-fontconfig.conf" \
      /etc/fonts/conf.d/09-texlive.conf && \
    fc-cache -f && rm -rf /var/lib/apt/lists/*
RUN version="$(curl -fsSL "https://dl.k8s.io/release/stable-${KUBECTL_MINOR}.txt")" && \
    curl -fsSL "https://dl.k8s.io/release/${version}/bin/linux/${TARGETARCH}/kubectl" -o /tmp/kubectl && \
    curl -fsSL "https://dl.k8s.io/release/${version}/bin/linux/${TARGETARCH}/kubectl.sha256" -o /tmp/kubectl.sha256 && \
    cd /tmp && printf '%s  kubectl\n' "$(cat kubectl.sha256)" | sha256sum --check && \
    install -m 0755 kubectl /usr/local/bin/kubectl && rm kubectl kubectl.sha256
COPY prepare-image.py /usr/local/lib/overleaf-openshift/prepare-image.py
COPY entrypoint.py /usr/local/lib/overleaf-openshift/entrypoint.py
COPY --from=cron /go/bin/supercronic /usr/local/bin/supercronic
COPY k8s-runner/KubernetesRunner.mjs k8s-runner/KubernetesApi.mjs k8s-runner/WorkspaceSync.mjs k8s-runner/rsync-rsh.sh /usr/local/lib/overleaf-openshift/k8s-runner/
COPY k8s-runner/OverleafKubernetesRunner.mjs /overleaf/services/clsi/app/js/OverleafKubernetesRunner.mjs
RUN python3 /usr/local/lib/overleaf-openshift/prepare-image.py
ENV HOME=/var/lib/overleaf/tmp/home \
    XDG_CACHE_HOME=/var/lib/overleaf/tmp/cache \
    GIT_BRIDGE_HOST=127.0.0.1 \
    NGINX_WORKER_PROCESSES=1
USER 1001:0
EXPOSE 8088
ENTRYPOINT ["python3", "/usr/local/lib/overleaf-openshift/entrypoint.py"]
