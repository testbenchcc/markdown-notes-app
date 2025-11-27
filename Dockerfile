FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN apt-get update
RUN apt-get install -y --no-install-recommends build-essential
RUN apt-get install -y git
RUN apt-get install -y nano
RUN apt-get install -y npm
RUN rm -rf /var/lib/apt/lists/*

RUN git config --global user.name "Tony"
RUN git config --global user.email "tony@testbench.cc"

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY package.json ./
COPY scripts/build-mermaid.js ./scripts/build-mermaid.js
RUN npm install

COPY . .

RUN rm -rf notes || true
RUN git clone https://github.com/testbenchcc/markdown-notes.git
RUN mv markdown-notes notes

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]