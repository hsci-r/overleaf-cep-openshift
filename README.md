# Overleaf CE+ on OpenShift

[Overleaf CE+](https://github.com/yu-i-i/overleaf-cep) adapted for OpenShift's
`restricted-v2` policy. Includes MongoDB, Redis, Git bridge and an HTTPS Route;
single-instance, amd64. Local compilation is the default and requires trusted
users. [Isolated Kubernetes compiles](docs/configuration.md#isolated-kubernetes-compiles)
are optional. For CSC Rahti, see [rahti/](rahti/README.md).

## Install

Requires Git, `oc` and Helm. Log in to your cluster, then:

```sh
git clone https://github.com/hsci-r/overleaf-cep-openshift.git
cd overleaf-cep-openshift
oc project YOUR_PROJECT
cp examples/openshift-values.yaml values.local.yaml
```

Set `route.host` to a hostname covered by your ingress certificate. Override the
four `storageClass` values if your cluster has no default StorageClass.

```sh
helm install overleaf charts/overleaf-openshift \
  -n "$(oc project -q)" -f values.local.yaml --wait --timeout 20m
```

Open `https://YOUR_HOST/launchpad` immediately to create the administrator.
Startup can take several minutes. Defaults request 42 GiB storage, 3.5 GiB memory
and 1.45 CPU cores. See [configuration](docs/configuration.md) and
[values.yaml](charts/overleaf-openshift/values.yaml).

## Images

Repository: `docker.io/hsci/overleaf-cep-openshift`.

| Tag | Contents |
| --- | --- |
| `latest` | CE+ with common LaTeX packages, fonts, bibliography tools, XeTeX and LuaTeX |
| `latest-full` | CE+ with full TeX Live |
| `latest-compiler` | Isolated runner with full TeX Live, Pandoc and Poppler |

Select the full application image with `image.tag: latest-full`.
For builds and publishing, see [development](docs/configuration.md#development).

## Operations

Read logs with `oc logs deployment/overleaf -c overleaf` or `-c git-bridge`.
For Git access, generate a token in Account Settings and use the project's Git
clone URL with username `git` and the token as password.

Before backup, scale the application to zero and wait for termination while
MongoDB and Redis remain running. Back up both databases, both application PVCs
and the generated Secret together. PVCs and the Secret are retained on uninstall.
