FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for moviepy/imagemagick if needed
RUN apt-get update && apt-get install -y \
    ffmpeg \
    imagemagick \
    fonts-liberation \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Fix for ImageMagick policy
RUN find /etc -name "policy.xml" -exec sed -i 's/none/read,write/g' {} + || true

# Copy API requirements and install
COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy API code
COPY apps/api .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
