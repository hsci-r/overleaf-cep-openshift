IMAGE_REPOSITORY ?= docker.io/hsci/overleaf-cep-openshift
IMAGE_TAG ?= 6.3.0-ext-v5.1-openshift.1
IMAGE ?= $(IMAGE_REPOSITORY):$(IMAGE_TAG)
FULL_TEXLIVE_IMAGE ?= docker.io/hsci/overleaf-ce-openshift:6.3.0-openshift.3-full@sha256:19964e77ee8424af345f33d9bfeec0a9ca47c936388bda9ca05c670c9e6f96de
FULL_IMAGE ?= $(IMAGE_REPOSITORY):$(IMAGE_TAG)-full

.PHONY: check image image-full push push-full package
check:
	helm lint charts/overleaf-openshift -f examples/openshift-values.yaml

image:
	docker build --platform linux/amd64 -t $(IMAGE) images/overleaf

image-full:
	docker build --platform linux/amd64 --build-arg TEXLIVE_IMAGE=$(FULL_TEXLIVE_IMAGE) -t $(FULL_IMAGE) images/overleaf

push:
	docker push --platform linux/amd64 $(IMAGE)

push-full:
	docker push --platform linux/amd64 $(FULL_IMAGE)

package: check
	mkdir -p dist
	helm package charts/overleaf-openshift --destination dist
