FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
RUN mkdir /data && useradd --uid 10001 --no-create-home gaam && chown gaam /data
USER gaam
ENV MEM0_TELEMETRY=false GRAPHITI_TELEMETRY_ENABLED=false
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "4780", "--no-access-log"]
