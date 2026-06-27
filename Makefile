.PHONY : help clean lint test dist info

help:
	@echo "'clean'       - remove all build/cache artifacts"
	@echo "'clean-build' - remove build artifacts"
	@echo "'clean-pyc'   - remove Python cache files"
	@echo "'clean-cov'   - remove coverage files"
	@echo "'clean-html'  - remove built documentation"
	@echo "'lint'        - run pre-commit hooks"
	@echo "'test'        - run tests with coverage"
	@echo "'dist'        - build sdist + wheel"
	@echo "'info'        - show environment info"

clean-build:
	rm -fr build/
	rm -fr dist/
	rm -fr *.egg-info

clean-pyc:
	find . -name '*.pyc' -exec rm -f {} +
	find . -name '*.pyo' -exec rm -f {} +
	find . -name '*~' -exec rm -f {} +

clean-cov:
	rm -rf coverage.xml .coverage

clean-html:
	rm -rf doc/source/_build

clean: clean-build clean-pyc clean-cov clean-html

lint:
	pre-commit run -a -v

test:
	pytest -v -r a --color=yes --cov=foliplus --cov-append --cov-report=term-missing --cov-report=xml test

dist:
	python -m build
	twine check --strict dist/*
	ls -l dist

html:
	cd doc/source && make html

info:
	@python -c "import platform,sys,os; print(f'Python: {sys.version.split()[0]}'); print(f'Platform: {platform.platform(terse=True)}'); print(f'Conda Env: {os.environ.get(\"CONDA_DEFAULT_ENV\",\"-\")}')"
	@python -c "from foliplus import __version__; print(f'foliplus: {__version__}')"
	@python -c "from foliplus._cdn import H3_JS,CHROMA_JS,GCOORD,SIMPLE_STATISTICS,LEAFLET_FULLSCREEN; print(f'CDN: h3={H3_JS} ss={SIMPLE_STATISTICS} chroma={CHROMA_JS} fullscreen={LEAFLET_FULLSCREEN} gcoord={GCOORD}')"
