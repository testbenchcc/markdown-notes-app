FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install system dependencies (if needed in future). Keep minimal for now.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && apt-get install -y git \
    && rm -rf /var/lib/apt/lists/*

RUN git config --global user.name "Tony" \
    && git config --global user.email "tony@testbench.cc"

RUN ssh-add /root/.ssh/id_ed25519

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
