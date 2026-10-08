# Overleaf CE+ on OpenShift

Helm deployment of [Overleaf CE+ 6.3.0-ext-v5.1](https://github.com/yu-i-i/overleaf-cep),
adapted from the [upstream Toolkit](https://github.com/overleaf/toolkit)
for OpenShift's `restricted-v2` policy. Includes MongoDB, Redis and an HTTPS Route.
Use a dedicated namespace for **trusted users**: CE+ compiles share application
credentials and network access. The deployment is single-instance and amd64.

For CSC Rahti, see [rahti/](rahti/README.md).

## Install

Requires Git, `oc`, Helm and Python 3. Log in to your cluster, then:

```sh
git clone https://github.com/hsci-r/overleaf-cep-openshift.git
cd overleaf-cep-openshift
oc project YOUR_PROJECT
export OVERLEAF_NAMESPACE="$(oc project -q)"
python3 scripts/create-secret.py --namespace "$OVERLEAF_NAMESPACE" | oc create -f -
cp examples/openshift-values.yaml values.local.yaml
```

Create the Secret **once**; preserve it on upgrades. Edit `values.local.yaml`:
set `route.host` to a hostname covered by your cluster's ingress certificate.
Set the three `storageClass` values if your cluster has no default StorageClass.

```sh
helm upgrade --install overleaf charts/overleaf-openshift \
  -n "$OVERLEAF_NAMESPACE" -f values.local.yaml --wait --timeout 20m
```

Open `https://YOUR_HOST/launchpad` immediately and create the first administrator.
Create a project and compile it. Startup can take several minutes.

The defaults request 32 GiB storage, 3.25 GiB memory and 1.35 CPU cores. PVCs are
retained on uninstall. Settings for self-signup, templates, SMTP, SSO and integrations are in
[configuration](docs/configuration.md) and [values.yaml](charts/overleaf-openshift/values.yaml).

## Images

Repository: `docker.io/hsci/overleaf-cep-openshift`.

| Tag | TeX Live packages |
| --- | --- |
| `6.3.0-ext-v5.1-openshift.3` | Common LaTeX packages, recommended fonts, bibliography tools, XeTeX and LuaTeX; chart default |
| `6.3.0-ext-v5.1-openshift.3-full` | All TeX Live packages (`scheme-full`); larger download |

Choose the full image with `image.tag: 6.3.0-ext-v5.1-openshift.3-full`. Packages are baked
into the images; do not install them in a running pod.

To build/publish your own copies:

```sh
docker login
make image image-full IMAGE_REPOSITORY=docker.io/YOUR_ACCOUNT/overleaf-cep-openshift
make push push-full IMAGE_REPOSITORY=docker.io/YOUR_ACCOUNT/overleaf-cep-openshift
```

## Operations

Use `oc logs deployment/overleaf` for startup errors. Configure `smtp` for email
and `registration` for optional self-signup; see [configuration](docs/configuration.md).

Before a backup or uninstall, scale the application to zero and wait for its pod
to terminate while MongoDB and Redis remain running, allowing edits to flush.
Back up both databases, the Overleaf PVC and the existing Secret together.
Upgrades run database migrations automatically; Helm rollback cannot undo them.
