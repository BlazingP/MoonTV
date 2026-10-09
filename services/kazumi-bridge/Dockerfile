FROM python:3.12-slim-bookworm
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && PLAYWRIGHT_BROWSERS_PATH=/opt/browsers python -m playwright install --with-deps chromium \
    && useradd --create-home --uid 1001 bridge
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers PYTHONUNBUFFERED=1
COPY *.py ./
COPY rules ./rules
USER bridge
EXPOSE 8787
CMD ["python", "app.py"]
