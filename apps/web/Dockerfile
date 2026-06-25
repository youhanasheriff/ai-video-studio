FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

COPY package.json ./
# If pnpm-lock exists, copy it (optional if volume is used but good for build)
# COPY pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install

COPY . .

CMD ["pnpm", "dev"]
