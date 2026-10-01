FROM python:3.12-slim
WORKDIR /app
COPY server.py ./
COPY public ./public
ENV HOST=0.0.0.0 PORT=8080 DATA_FILE=/data/state.json
RUN useradd --uid 10001 --create-home app && mkdir /data && chown app:app /data
USER app
EXPOSE 8080
CMD ["python", "server.py"]
