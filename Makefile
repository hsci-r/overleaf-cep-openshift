IMAGE_REPOSITORY ?= docker.io/hsci/overleaf-cep-openshift
IMAGE_TAG ?= latest
OVERLEAF_BASE_IMAGE ?= $(shell python3 scripts/upstream-image.py)
IMAGE ?= $(IMAGE_REPOSITORY):$(IMAGE_TAG)
FULL_IMAGE ?= $(IMAGE_REPOSITORY):$(IMAGE_TAG)-full
COMPILER_IMAGE ?= $(IMAGE_REPOSITORY):$(IMAGE_TAG)-compiler

.PHONY: check check-integration image image-full image-compiler push push-full push-compiler package
check:
	helm lint charts/overleaf-openshift -f examples/openshift-values.yaml
	helm lint charts/overleaf-openshift -f examples/openshift-values.yaml --set compilation.backend=kubernetes --set compilation.kubernetes.namespace=overleaf-compilers
	npm ci --prefix images/overleaf/k8s-runner --ignore-scripts --no-audit --no-fund
	npm test --prefix images/overleaf/k8s-runner

check-integration: image-compiler
	RUN_COMPILER_INTEGRATION=1 COMPILER_TEST_IMAGE=$(COMPILER_IMAGE) npm run test:acceptance --prefix images/overleaf/k8s-runner -- --grep 'Compiler image'

image:
	docker build --pull --platform linux/amd64 --build-arg OVERLEAF_BASE_IMAGE=$(OVERLEAF_BASE_IMAGE) -t $(IMAGE) images/overleaf

image-full:
	docker build --pull --platform linux/amd64 --build-arg OVERLEAF_BASE_IMAGE=$(OVERLEAF_BASE_IMAGE) --build-arg TEXLIVE_PACKAGES=scheme-full -t $(FULL_IMAGE) images/overleaf

image-compiler:
	docker build --pull --platform linux/amd64 -f images/overleaf/compiler.Dockerfile -t $(COMPILER_IMAGE) images/overleaf

push:
	docker push --platform linux/amd64 $(IMAGE)

push-full:
	docker push --platform linux/amd64 $(FULL_IMAGE)

push-compiler:
	docker push --platform linux/amd64 $(COMPILER_IMAGE)

package: check
	mkdir -p dist
	helm package charts/overleaf-openshift --destination dist
