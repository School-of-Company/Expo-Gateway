# One image for everything except Eureka (real), Prometheus, Grafana and k6:
# gateway, stub backends, stub config server, stub Eureka.
FROM node:26-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npx tsc -p load-test/stub-backend/tsconfig.json
