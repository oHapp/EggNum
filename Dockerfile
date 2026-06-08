# ==============================================
#  鸡蛋库存登记助手 — 1.3.5
# ==============================================
FROM python:3.13-slim

# Build-time version arg (bump to bust cache on deploy)
ARG APP_VERSION=dev

# Prevent .pyc files and buffered output
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV APP_VERSION=${APP_VERSION}

WORKDIR /app

# Install dependencies (cached unless requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Database directory (mounted as volume at runtime)
ENV EGGS_DB_DIR=/data
RUN mkdir -p /data

# Production WSGI server
EXPOSE 5000
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "60", "app:app"]
