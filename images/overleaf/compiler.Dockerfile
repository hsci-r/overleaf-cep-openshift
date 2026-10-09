# The compiler follows the full TeX Live image recommended by CE+.
FROM texlive/texlive:latest-full
USER root
RUN apt-get update && apt-get install -y --no-install-recommends pandoc poppler-utils rsync && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /work && ln -s /work/compile /compile
COPY k8s-runner/worker.py /opt/overleaf-runner/worker.py
ENV HOME=/tmp/home XDG_CACHE_HOME=/tmp/cache
WORKDIR /work
USER 1001:0
ENTRYPOINT ["python3", "/opt/overleaf-runner/worker.py", "serve"]
