IMAGE_REPOSITORY ?= docker.io/hsci/overleaf-cep-openshift
IMAGE_TAG ?= 6.3.0-ext-v5.1-openshift.3
IMAGE ?= $(IMAGE_REPOSITORY):$(IMAGE_TAG)
FULL_IMAGE ?= $(IMAGE_REPOSITORY):$(IMAGE_TAG)-full

.PHONY: check image image-full push push-full package
check:
	helm lint charts/overleaf-openshift -f examples/openshift-values.yaml

image:
	docker build --platform linux/amd64 -t $(IMAGE) images/overleaf

image-full:
	docker build --platform linux/amd64 --build-arg TEXLIVE_PACKAGES=scheme-full -t $(FULL_IMAGE) images/overleaf

push:
	docker push --platform linux/amd64 $(IMAGE)

push-full:
	docker push --platform linux/amd64 $(FULL_IMAGE)

package: check
	mkdir -p dist
	helm package charts/overleaf-openshift --destination dist
