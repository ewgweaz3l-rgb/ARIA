# ARIA squad server (leaderboards, versus lobby, pilot reports) — for Railway or any container host.
# The desktop app doesn't use this file. Only squad.py / squad_server.py / VERSION go into the image.
FROM python:3.12-slim
WORKDIR /app
COPY squad.py squad_server.py VERSION ./
ENV PYTHONUNBUFFERED=1
EXPOSE 8777
CMD ["python", "squad_server.py"]
