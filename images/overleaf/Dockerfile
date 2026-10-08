# Keep the already validated TeX Live packages while replacing the application.
ARG TEXLIVE_IMAGE=docker.io/hsci/overleaf-ce-openshift:6.3.0-openshift.3@sha256:2b18c22d077b48e531bd82fd2f89c5eaeeec710e178bc06acd48a2709313c181
ARG OVERLEAF_BASE_IMAGE=overleafcep/sharelatex:6.3.0-ext-v5.1@sha256:3077cb674adff9155d5f7f3ddbb52c384565adbb1011f610706e7ae3dfd8d962
FROM ${TEXLIVE_IMAGE} AS texlive
FROM ${OVERLEAF_BASE_IMAGE}
USER root
COPY --from=texlive /usr/local/texlive /usr/local/texlive
# Install the native tools required for fonts and optional document conversion.
RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/ubuntu.sources && \
    apt-get update && apt-get install -y --no-install-recommends fontconfig pandoc zip && \
    tlmgr path add && \
    cp "$(kpsewhich -var-value TEXMFSYSVAR)/fonts/conf/texlive-fontconfig.conf" \
      /etc/fonts/conf.d/09-texlive.conf && \
    fc-cache -f && rm -rf /var/lib/apt/lists/*
COPY prepare-image.py /usr/local/lib/overleaf-openshift/prepare-image.py
COPY entrypoint.py /usr/local/lib/overleaf-openshift/entrypoint.py
COPY healthcheck.py /usr/local/lib/overleaf-openshift/healthcheck.py
RUN python3 /usr/local/lib/overleaf-openshift/prepare-image.py
ENV HOME=/var/lib/overleaf/tmp/home \
    XDG_CACHE_HOME=/var/lib/overleaf/tmp/cache \
    NGINX_WORKER_PROCESSES=1
USER 1001:0
EXPOSE 8088
ENTRYPOINT ["python3", "/usr/local/lib/overleaf-openshift/entrypoint.py"]
